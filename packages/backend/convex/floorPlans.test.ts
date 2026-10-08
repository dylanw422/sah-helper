/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import { expect, test } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { blankPlan, parsePlan, starterPlan } from "./lib/floorPlanModel";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const client = { name: "Alex Client", street: "", city: "", state: "", zip: "", phone: "", caseNumber: "", drawCount: 4 as const };
const document = (id = "test-plan", name = "House") => JSON.stringify({ ...blankPlan(name), id });
async function setup() {
  const t = convexTest(schema, modules); betterAuthTest.register(t);
  const account = async (email: string) => {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { email, name: email, emailVerified: false, createdAt: now, updatedAt: now } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: user._id, token: email, expiresAt: now + 3600_000, createdAt: now, updatedAt: now } } });
    const a = t.withIdentity({ subject: user._id, issuer: "https://test.convex.site", sessionId: session._id });
    await a.mutation(api.workspaces.create, { companyName: email, contractorName: "Contractor", street: "10 Main", city: "Austin", state: "TX", zip: "78701", phone: "555-0100", license: "ABC" });
    return a;
  };
  return { t, a: await account("plans-a@example.com"), b: await account("plans-b@example.com") };
}

test("creating a client saves an editable plan atomically and is safe to retry", async () => {
  const { a } = await setup();
  const args = { client: { ...client, name: "  Alex Client  " }, document: document(), expectedRevision: 0, requestId: "request-1" };
  const saved = await a.mutation(api.floorPlans.saveToNewClient, args);
  expect(saved).toMatchObject({ clientName: "Alex Client", name: "House", revision: 1, wallCount: 0, fixtureCount: 0 });
  expect(await a.mutation(api.floorPlans.saveToNewClient, args)).toEqual(saved);
  expect(await a.query(api.floorPlans.listClients, {})).toHaveLength(1);
  expect(await a.query(api.floorPlans.list, { clientId: saved.clientId })).toEqual([saved]);
  expect((await a.query(api.floorPlans.get, { id: saved.id })).document).toBe(args.document);
  const c = await a.query(api.clients.getClient, { clientId: saved.clientId });
  expect(c).toMatchObject({ name: "Alex Client", total: 0, drawCount: 4, lineItems: [], status: "unsigned" });
  expect(c?.packetStorageId).toBeUndefined();
  await expect(a.mutation(api.floorPlans.saveToNewClient, { ...args, client: { ...client, name: "  " }, document: document("invalid-name"), requestId: "request-2" })).rejects.toThrow("client name");
  await expect(a.mutation(api.floorPlans.saveToNewClient, { ...args, document: "{}", requestId: "request-3" })).rejects.toThrow("valid floor-plan");
  await expect(a.mutation(api.floorPlans.saveToNewClient, { ...args, document: "x".repeat(750_001), requestId: "request-4" })).rejects.toThrow("too large");
  expect(await a.query(api.floorPlans.listClients, {})).toHaveLength(1);
});

test("client plans preserve roof type, accept legacy backups, and reject invalid roof settings", async () => {
  const { a } = await setup();
  const plan = { ...blankPlan("Roof styles"), roofType: "hip" as const };
  const saved = await a.mutation(api.floorPlans.saveToNewClient, { client, document: JSON.stringify(plan), expectedRevision: 0, requestId: "hip-roof" });
  expect(parsePlan(JSON.parse((await a.query(api.floorPlans.get, { id: saved.id })).document)).roofType).toBe("hip");
  const updated = await a.mutation(api.floorPlans.save, { clientId: saved.clientId, document: JSON.stringify({ ...plan, roofType: "gable" }), expectedRevision: 1 });
  expect(updated.revision).toBe(2);
  expect(parsePlan(JSON.parse((await a.query(api.floorPlans.get, { id: saved.id })).document)).roofType).toBe("gable");
  await expect(a.mutation(api.floorPlans.save, { clientId: saved.clientId, document: JSON.stringify({ ...plan, roofType: "invalid" }), expectedRevision: 2 })).rejects.toThrow("valid floor-plan");
  const { roofType, ...legacy } = plan;
  await a.mutation(api.floorPlans.save, { clientId: saved.clientId, document: JSON.stringify(legacy), expectedRevision: 2 });
  expect(parsePlan(JSON.parse((await a.query(api.floorPlans.get, { id: saved.id })).document)).roofType).toBe("gable");
});

test("updates use revisions, retry without duplicating, and move plans between clients", async () => {
  const { a } = await setup();
  const original = await a.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "first" });
  const edited = document("test-plan", "Updated house");
  const updated = await a.mutation(api.floorPlans.save, { clientId: original.clientId, document: edited, expectedRevision: 1 });
  expect(updated).toMatchObject({ id: original.id, name: "Updated house", revision: 2 });
  expect(await a.mutation(api.floorPlans.save, { clientId: original.clientId, document: edited, expectedRevision: 1 })).toEqual(updated);
  await expect(a.mutation(api.floorPlans.save, { clientId: original.clientId, document: document("test-plan", "Stale edit"), expectedRevision: 1 })).rejects.toThrow("newer version");
  await expect(a.mutation(api.floorPlans.saveToNewClient, { client: { ...client, name: "Orphan" }, document: document("test-plan", "Stale edit"), expectedRevision: 1, requestId: "stale" })).rejects.toThrow("newer version");
  expect(await a.query(api.floorPlans.listClients, {})).toHaveLength(1);
  const other = await a.mutation(api.floorPlans.saveToNewClient, { client: { ...client, name: "Other client" }, document: document("other-plan"), expectedRevision: 0, requestId: "second" });
  await expect(a.mutation(api.floorPlans.save, { clientId: other.clientId, document: edited, expectedRevision: 2 })).rejects.toThrow("already has a Before");
  await a.mutation(api.floorPlans.remove, { id: other.id });
  const moved = await a.mutation(api.floorPlans.save, { clientId: other.clientId, document: edited, expectedRevision: 2 });
  expect(moved).toMatchObject({ id: original.id, clientName: "Other client", revision: 3 });
  expect(await a.query(api.floorPlans.list, { clientId: original.clientId })).toEqual([]);
  expect(await a.query(api.floorPlans.list, { clientId: other.clientId })).toHaveLength(1);
});

test("plan and client IDs never grant access across workspaces, and auth is required", async () => {
  const { t, a, b } = await setup();
  const saved = await a.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "private" });
  expect(await b.query(api.floorPlans.list, {})).toEqual([]);
  expect(await b.query(api.floorPlans.listClients, {})).toEqual([]);
  await expect(b.query(api.floorPlans.get, { id: saved.id })).rejects.toThrow("workspace");
  await expect(b.query(api.floorPlans.list, { clientId: saved.clientId })).rejects.toThrow("workspace");
  await expect(b.mutation(api.floorPlans.remove, { id: saved.id })).rejects.toThrow("workspace");
  await expect(b.mutation(api.floorPlans.save, { clientId: saved.clientId, document: document(), expectedRevision: 1 })).rejects.toThrow("workspace");
  await expect(t.query(api.floorPlans.list, {})).rejects.toThrow("Not authenticated");
  await expect(t.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "unauth" })).rejects.toThrow("Not authenticated");
  const own = await b.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "own" });
  expect(own.id).not.toBe(saved.id);
  expect((await a.query(api.floorPlans.get, { id: saved.id })).summary.revision).toBe(1);
});

test("deleting a plan preserves the client; deleting a client removes all its plans", async () => {
  const { t, a } = await setup();
  const saved = await a.mutation(api.floorPlans.saveToNewClient, { client, document: JSON.stringify(starterPlan()), expectedRevision: 0, requestId: "delete" });
  const second = await a.mutation(api.floorPlans.start, { clientId: saved.clientId, stage: "after" });
  await expect(a.mutation(api.floorPlans.remove, { id: saved.id })).rejects.toThrow("After plan first");
  await a.mutation(api.floorPlans.remove, { id: second.summary.id });
  expect(await a.query(api.clients.getClient, { clientId: saved.clientId })).toBeTruthy();
  expect(await a.query(api.floorPlans.list, { clientId: saved.clientId })).toEqual([saved]);
  await a.mutation(api.clients.deleteClient, { clientId: saved.clientId });
  expect(await t.run(ctx => ctx.db.get(saved.id))).toBeNull();
  expect(await a.query(api.floorPlans.list, {})).toEqual([]);
});

test("legacy extra plans are archived without deleting drawings, and duplicate Before plans are rejected", async () => {
  const { t, a } = await setup();
  const saved = await a.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "limit" });
  await t.run(async ctx => {
    const row = (await ctx.db.get(saved.id))!;
    const { _id, _creationTime, ...data } = row;
    for (let i = 1; i < 100; i++) await ctx.db.insert("floorPlans", { ...data, draftId: `limit-${i}` });
  });
  await expect(a.mutation(api.floorPlans.save, { clientId: saved.clientId, document: document("overflow"), expectedRevision: 0 })).rejects.toThrow("already has a Before");
  expect((await a.mutation(api.floorPlans.save, { clientId: saved.clientId, document: document("test-plan", "Still editable"), expectedRevision: 1 })).revision).toBe(2);
  const plans = await a.query(api.floorPlans.list, { clientId: saved.clientId });
  expect(plans).toHaveLength(100);
  expect(plans.filter(p => p.stage === "before")).toHaveLength(1);
  expect(plans.filter(p => p.stage === "archive")).toHaveLength(99);
});

test("legacy workspace members can save plans without exposing them to new companies", async () => {
  const { t, a, b } = await setup();
  await t.run(async ctx => {
    const membership = (await ctx.db.query("authorizedUsers").withIndex("by_email", q => q.eq("email", "plans-a@example.com")).unique())!;
    await ctx.db.patch(membership._id, { workspaceId: undefined });
  });
  const saved = await a.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "legacy" });
  expect((await a.query(api.floorPlans.get, { id: saved.id })).summary.clientName).toBe(client.name);
  expect(await a.query(api.floorPlans.list, {})).toEqual([saved]);
  expect(await b.query(api.floorPlans.list, {})).toEqual([]);
  await expect(b.query(api.floorPlans.get, { id: saved.id })).rejects.toThrow("workspace");
  await a.mutation(api.floorPlans.remove, { id: saved.id });
  await expect(a.query(api.floorPlans.get, { id: saved.id })).rejects.toThrow("workspace");
});


test("After copies the saved Before once and remains independent through edits and retries", async () => {
  const { a } = await setup();
  const plan = starterPlan();
  plan.openings[0] = { ...plan.openings[0], hinge: "right", flip: true };
  plan.notes = [{ id: "construction-note", x: 520, y: 24, width: 144, fontSize: 8, text: "Verify dimensions on site.\nRetain existing exterior walls.", border: true }];
  const before = await a.mutation(api.floorPlans.saveToNewClient, { client, document: JSON.stringify(plan), expectedRevision: 0, requestId: "paired" });
  expect(before.stage).toBe("before");
  const after = await a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after", expectedBeforeRevision: 1 });
  const copy = parsePlan(JSON.parse(after.document));
  expect(after.summary.stage).toBe("after");
  expect(copy.id).not.toBe(plan.id);
  for (const key of ["walls", "openings", "fixtures", "utilities", "notes", "rooms", "roofType", "roofOverhang"] as const) expect(copy[key]).toEqual(plan[key]);
  const modified = { ...copy, fixtures: copy.fixtures.slice(1), openings: copy.openings.map((o, i) => i === 0 ? { ...o, hinge: "left" as const, flip: false } : o), notes: copy.notes.map(n => ({ ...n, text: "Remove existing interior partition." })) };
  await a.mutation(api.floorPlans.save, { clientId: before.clientId, document: JSON.stringify(modified), expectedRevision: 1, stage: "after" });
  expect((await a.query(api.floorPlans.get, { id: before.id })).document).toBe(JSON.stringify(plan));
  const reopened = await a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after", expectedBeforeRevision: 1 });
  expect(reopened.summary.id).toBe(after.summary.id);
  expect(JSON.parse(reopened.document).fixtures).toEqual(modified.fixtures);
  expect(JSON.parse(reopened.document).openings[0]).toMatchObject({ hinge: "left", flip: false });
  expect(JSON.parse(reopened.document).notes).toEqual(modified.notes);
  await expect(a.mutation(api.floorPlans.save, { clientId: before.clientId, document: JSON.stringify({ ...modified, notes: modified.notes.map(n => ({ ...n, width: -1 })) }), expectedRevision: 2, stage: "after" })).rejects.toThrow("valid floor-plan");
  await expect(a.mutation(api.floorPlans.save, { clientId: before.clientId, document: JSON.stringify({ ...modified, openings: modified.openings.map((o, i) => i === 0 ? { ...o, hinge: "top" } : o) }), expectedRevision: 2, stage: "after" })).rejects.toThrow("valid floor-plan");
  const plans = await a.query(api.floorPlans.list, { clientId: before.clientId });
  expect(plans.map(p => p.stage).sort()).toEqual(["after", "before"]);
  await expect(a.mutation(api.floorPlans.save, { clientId: before.clientId, document: document("third"), expectedRevision: 0, stage: "after" })).rejects.toThrow("already has an After");
  await expect(a.mutation(api.floorPlans.save, { clientId: before.clientId, document: JSON.stringify(plan), expectedRevision: 1, stage: "after" })).rejects.toThrow("keeps its Before or After stage");
  await expect(a.mutation(api.floorPlans.saveToNewClient, { client: { ...client, name: "Moved" }, document: JSON.stringify(plan), expectedRevision: 1, requestId: "move-pair" })).rejects.toThrow("same client");
  expect(await a.query(api.floorPlans.listClients, {})).toHaveLength(1);
});

test("Before is required and empty plans cannot seed After; the clone rejects a stale Before revision", async () => {
  const { a, b, t } = await setup();
  const before = await a.mutation(api.floorPlans.saveToNewClient, { client, document: document(), expectedRevision: 0, requestId: "empty" });
  await expect(a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after" })).rejects.toThrow("Before plan first");
  await expect(a.mutation(api.floorPlans.save, { clientId: before.clientId, document: document("after"), expectedRevision: 0, stage: "after" })).rejects.toThrow("Before plan first");
  const started = await a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "before" });
  expect(started.summary.id).toBe(before.id);
  const drawn = { ...starterPlan(), id: "test-plan" };
  await a.mutation(api.floorPlans.save, { clientId: before.clientId, document: JSON.stringify(drawn), expectedRevision: 1 });
  await expect(a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after", expectedBeforeRevision: 1 })).rejects.toThrow("newer version");
  expect(await a.query(api.floorPlans.list, { clientId: before.clientId })).toHaveLength(1);
  await expect(b.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after" })).rejects.toThrow("workspace");
  await expect(t.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "before" })).rejects.toThrow("Not authenticated");
  const after = await a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after", expectedBeforeRevision: 2 });
  expect(JSON.parse(after.document).walls).toEqual(drawn.walls);
});

test("simultaneous stage creation returns one canonical After and never replaces either stage", async () => {
  const { a } = await setup();
  const before = await a.mutation(api.floorPlans.saveToNewClient, { client, document: JSON.stringify(starterPlan()), expectedRevision: 0, requestId: "race" });
  const results = await Promise.all([a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after" }), a.mutation(api.floorPlans.start, { clientId: before.clientId, stage: "after" })]);
  expect(results[0].summary.id).toBe(results[1].summary.id);
  expect(await a.query(api.floorPlans.list, { clientId: before.clientId })).toHaveLength(2);
});

test("unclassified existing drawings get stable stages, with all extras preserved as previous plans", async () => {
  const { t, a } = await setup();
  const first = await a.mutation(api.floorPlans.saveToNewClient, { client, document: JSON.stringify(starterPlan()), expectedRevision: 0, requestId: "old-plans" });
  await t.run(async ctx => {
    const row = (await ctx.db.get(first.id))!;
    await ctx.db.patch(first.id, { stage: undefined, createdAt: 1 });
    const { _id, _creationTime, ...data } = row;
    for (let i = 2; i <= 3; i++) await ctx.db.insert("floorPlans", { ...data, stage: undefined, draftId: `legacy-${i}`, document: JSON.stringify({ ...starterPlan(), id: `legacy-${i}` }), createdAt: i });
  });
  const initial = await a.query(api.floorPlans.list, { clientId: first.clientId });
  expect(initial.find(p => p.id === first.id)?.stage).toBe("before");
  expect(initial.filter(p => p.stage === "after")).toHaveLength(1);
  const after = initial.find(p => p.stage === "after")!;
  const copy = await a.mutation(api.floorPlans.start, { clientId: first.clientId, stage: "after" });
  expect(copy.summary.id).toBe(after.id);
  await a.mutation(api.floorPlans.remove, { id: after.id });
  const remaining = await a.query(api.floorPlans.list, { clientId: first.clientId });
  expect(remaining).toHaveLength(2);
  expect(remaining.filter(p => p.stage === "archive")).toHaveLength(1);
  expect(remaining.filter(p => p.stage === "after")).toHaveLength(0);
});
