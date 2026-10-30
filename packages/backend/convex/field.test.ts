/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import { expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildDrawSchedule } from "./lib/drawSchedule";
import { drawWorkDescription, drawWorkFromSchedule } from "./lib/drawWorkSchedule";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
function setup() { const t = convexTest(schema, modules); betterAuthTest.register(t); return t; }
type Test = ReturnType<typeof setup>;
async function account(t: Test, email: string) {
  const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { email, name: email.split("@")[0], emailVerified: false, createdAt: Date.now(), updatedAt: Date.now() } } });
  const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: user._id, token: email, expiresAt: Date.now() + 3600_000, createdAt: Date.now(), updatedAt: Date.now() } } });
  return t.withIdentity({ subject: user._id, issuer: "https://test.convex.site", sessionId: session._id });
}
async function fixture() {
  const t = setup();
  const office = await account(t, "office@example.com");
  const outsider = await account(t, "outsider@example.com");
  const field = t; // A Field GC has no identity or account.
  const wrong = await account(t, "wrong@example.com");
  const company = { companyName: "Office", contractorName: "Office GC", street: "1 Main", city: "Austin", state: "TX", zip: "78701", phone: "555-0100", license: "" };
  const workspaceId = await office.mutation(api.workspaces.create, company);
  const otherWorkspace = await outsider.mutation(api.workspaces.create, { ...company, companyName: "Other office" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["Secret financial packet"], { type: "application/pdf" })));
  await t.mutation(internal.uploads.registerGenerated, { storageId, workspaceId });
  const data = { name: "Assigned client", street: "20 Main", city: "Austin", state: "TX", zip: "78701", phone: "555-0200", invoiceNumber: "PRIVATE-INVOICE", caseNumber: "PRIVATE-CASE",
    drawCount: 4 as const, lineItems: [
      ...["Demolition, debris removal", "Framing and backing", "Plumbing rough-in", "Electrical rough-in", "Accessible fixtures", "Finishes and paint"].map((description, i) => ({ description, qty: 1, unitPrice: [10000, 10000, 19500, 19500, 20500, 20500][i]!, amount: [10000, 10000, 19500, 19500, 20500, 20500][i]! })),
      { description: "Profit", qty: 1, unitPrice: 23456, amount: 23456 },
    ], subtotal: 123456, total: 123456, packetStorageId: storageId };
  const clientId = await office.mutation(api.clients.createClient, data);
  const unassignedId = await office.mutation(api.clients.createClient, { ...data, name: "Unassigned client" });
  const foreignId = await t.run(ctx => ctx.db.insert("clients", { ...data, workspaceId: otherWorkspace, name: "Foreign client", status: "unsigned", createdAt: 1, updatedAt: 1 }));
  const projectLink = await office.mutation(api.field.createProjectLink, { clientId, label: "BuildCo" });
  return { t, office, outsider, field, wrong, workspaceId, clientId, unassignedId, foreignId, projectLink, storageId, data };
}
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVhsAAAAASUVORK5CYII="), c => c.charCodeAt(0));
async function uploadPhoto(f: Awaited<ReturnType<typeof fixture>>, taskId: Id<"projectTasks">) {
  const url = new URL(await f.field.mutation(api.field.createPhotoUpload, { token: f.projectLink.token, taskId, filename: "progress.png" }));
  const path = url.pathname + url.search;
  const response = await f.t.fetch(path, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Blob([png], { type: "image/png" }) });
  expect(response.status).toBe(200);
  return { path, id: (await response.json() as { id: Id<"projectFiles"> }).id };
}

test("project links work without accounts, are hashed, and replacement revokes earlier access", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  expect((await f.t.query(api.field.linkProject, { token }))?.project.id).toBe(f.clientId);
  expect((await f.wrong.query(api.field.linkProject, { token }))?.project.id).toBe(f.clientId);
  expect((await f.office.query(api.field.getProject, { clientId: f.clientId, token })).office).toBe(false);
  const stored = await f.t.run(ctx => ctx.db.query("fieldProjectLinks").first());
  expect(stored?.tokenHash).toHaveLength(64);
  expect(JSON.stringify(stored)).not.toContain(token);
  expect(await f.t.run(ctx => ctx.db.query("fieldUsers").first())).toBeNull();
  expect(await f.t.query(api.field.linkProject, { token: "guessed" })).toBeNull();
  await expect(f.t.query(api.field.getProject, { clientId: f.clientId })).rejects.toThrow("Sign in");
  const next = await f.office.mutation(api.field.createProjectLink, { clientId: f.clientId, label: "BuildCo" });
  expect(await f.t.query(api.field.linkProject, { token })).toBeNull();
  await expect(f.t.query(api.field.getProject, { clientId: f.clientId, token })).rejects.toThrow("no longer available");
  expect((await f.t.query(api.field.getProject, { clientId: f.clientId, token: next.token })).project.id).toBe(f.clientId);
  const team = await f.office.query(api.field.projectTeam, { clientId: f.clientId });
  await expect(f.outsider.mutation(api.field.revokeProjectLink, { id: team.link!.id })).rejects.toThrow("workspace");
  await f.office.mutation(api.field.revokeProjectLink, { id: team.link!.id });
  expect(await f.t.query(api.field.linkProject, { token: next.token })).toBeNull();
});

test("Field GCs receive only project-scoped nonfinancial project data and cannot call financial or administration APIs", async () => {
  const f = await fixture();
  await expect(f.field.query(api.field.listProjects)).rejects.toThrow();
  const view = await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId });
  expect(Object.keys(view.project).sort()).toEqual(["address", "id", "name"]);
  const serialized = JSON.stringify(view);
  for (const secret of ["123456", "PRIVATE-INVOICE", "PRIVATE-CASE", "Private pricing", f.storageId, "packetStorageId", "unitPrice", "subtotal"]) expect(serialized).not.toContain(secret);
  await expect(f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.unassignedId })).rejects.toThrow(/access|no longer available/);
  await expect(f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.foreignId })).rejects.toThrow(/access|no longer available/);
  await expect(f.outsider.query(api.field.getProject, { clientId: f.clientId })).rejects.toThrow("workspace");
  await expect(f.field.query(api.clients.listClients)).rejects.toThrow();
  await expect(f.field.query(api.clients.getClient, { clientId: f.clientId })).rejects.toThrow();
  await expect(f.field.query(api.clients.getPacketDownloadUrl, { clientId: f.clientId })).rejects.toThrow();
  await expect(f.field.query(api.settings.getSettings)).rejects.toThrow();
  await expect(f.field.query(api.invoiceBuilder.listInvoices)).rejects.toThrow();
  await expect(f.field.query(api.clientFiles.listClientFiles, { clientId: f.clientId })).rejects.toThrow();
  await expect(f.field.query(api.customDocuments.listCustomDocuments, {})).rejects.toThrow();
  await expect(f.field.query(api.users.listUsers)).rejects.toThrow();
  await expect(f.field.query(api.field.notifications)).rejects.toThrow();
  await expect(f.field.query(api.field.projectTeam, { clientId: f.clientId })).rejects.toThrow(/office|Sign in/);
  await expect(f.field.mutation(api.field.createProjectLink, { clientId: f.clientId, label: "Other" })).rejects.toThrow(/office|Sign in/);
  await expect(f.field.mutation(api.field.addStage, { clientId: f.clientId, title: "Unauthorized", instructions: "" })).rejects.toThrow(/office|Sign in/);
});

test("photos, task completion, blockers and office review follow the construction workflow", async () => {
  const f = await fixture();
  let view = await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId });
  const stage = view.stages[0];
  const fieldTask = stage.tasks.find(t => t.kind === "field")!;
  const officeTask = stage.tasks.find(t => t.kind === "office")!;
  await expect(f.field.mutation(api.field.setTaskCompleted, { token: f.projectLink.token, taskId: fieldTask.id, completed: true })).rejects.toThrow("photo");
  await expect(f.field.mutation(api.field.setTaskCompleted, { token: f.projectLink.token, taskId: officeTask.id, completed: true })).rejects.toThrow(/office|Sign in/);
  await expect(f.field.mutation(api.field.submitStage, { token: f.projectLink.token, stageId: stage.id })).rejects.toThrow("Complete all");
  const uploaded = await uploadPhoto(f, fieldTask.id);
  expect((await f.t.fetch(uploaded.path, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Blob([png]) })).status).toBe(400);
  expect((await f.field.action(api.field.readFile, { token: f.projectLink.token, id: uploaded.id })).bytes.byteLength).toBe(png.byteLength);
  await expect(f.wrong.action(api.field.readFile, { id: uploaded.id })).rejects.toThrow();
  await f.field.mutation(api.field.setTaskCompleted, { token: f.projectLink.token, taskId: fieldTask.id, completed: true });
  for (const other of stage.tasks.filter(task => task.kind === "field" && task.id !== fieldTask.id)) {
    await uploadPhoto(f, other.id);
    await f.field.mutation(api.field.setTaskCompleted, { token: f.projectLink.token, taskId: other.id, completed: true });
  }
  await f.field.mutation(api.field.reportBlocker, { token: f.projectLink.token, stageId: stage.id, message: "Waiting for inspection" });
  await expect(f.field.mutation(api.field.submitStage, { token: f.projectLink.token, stageId: stage.id })).rejects.toThrow("blocker");
  await f.field.mutation(api.field.reportBlocker, { token: f.projectLink.token, stageId: stage.id, message: "" });
  await f.field.mutation(api.field.submitStage, { token: f.projectLink.token, stageId: stage.id });
  await expect(f.field.mutation(api.field.setTaskCompleted, { token: f.projectLink.token, taskId: fieldTask.id, completed: false })).rejects.toThrow("review");
  await expect(f.field.mutation(api.field.reviewStage, { stageId: stage.id, decision: "verified", note: "" })).rejects.toThrow(/office|Sign in/);
  await expect(f.office.mutation(api.field.reviewStage, { stageId: stage.id, decision: "changes_requested", note: "" })).rejects.toThrow("Review note");
  await f.office.mutation(api.field.reviewStage, { stageId: stage.id, decision: "changes_requested", note: "Need a wider completion photo" });
  await f.field.mutation(api.field.submitStage, { token: f.projectLink.token, stageId: stage.id });
  await f.office.mutation(api.field.reviewStage, { stageId: stage.id, decision: "verified", note: "Work reviewed" });
  view = await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId });
  expect(view.stages[0].status).toBe("verified");
  expect(view.stages[0].tasks.filter(t => t.kind === "office").every(t => !t.completed)).toBe(true);
  await f.office.mutation(api.field.setTaskCompleted, { taskId: officeTask.id, completed: true });
  await f.office.mutation(api.field.reviewStage, { stageId: stage.id, decision: "changes_requested", note: "Follow-up work needed" });
  expect((await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId })).stages[0].status).toBe("changes_requested");
  expect(view.files.every(file => !("storageId" in file) && !("url" in file))).toBe(true);
});

test("revoking a project blocks photo uploads and file reads, including already-issued upload links", async () => {
  const f = await fixture();
  const project = await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId });
  const taskId = project.stages[0].tasks.find(t => t.kind === "field")!.id;
  const photo = await uploadPhoto(f, taskId);
  const pending = new URL(await f.field.mutation(api.field.createPhotoUpload, { token: f.projectLink.token, taskId, filename: "pending.png" }));
  const team = await f.office.query(api.field.projectTeam, { clientId: f.clientId });
  await f.office.mutation(api.field.revokeProjectLink, { id: team.link!.id });
  await expect(f.field.action(api.field.readFile, { token: f.projectLink.token, id: photo.id })).rejects.toThrow(/access|no longer available/);
  await expect(f.field.mutation(api.field.createPhotoUpload, { token: f.projectLink.token, taskId, filename: "new.png" })).rejects.toThrow(/access|no longer available/);
  expect((await f.t.fetch(pending.pathname + pending.search, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Blob([png]) })).status).toBe(400);
  expect((await f.office.action(api.field.readFile, { id: photo.id })).bytes.byteLength).toBe(png.byteLength);
});

test("only the office can share explicitly selected nonfinancial uploads, and unsharing revokes future reads", async () => {
  const f = await fixture();
  const planId = await f.t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["Plan PDF"], { type: "application/pdf" }));
    await ctx.db.insert("workspaceFiles", { storageId, workspaceId: f.workspaceId });
    return ctx.db.insert("clientFiles", { workspaceId: f.workspaceId, clientId: f.clientId, storageId, filename: "Plans.pdf", type: "uploaded", order: 1, addedAt: 1 });
  });
  const financialId = await f.office.mutation(api.clientFiles.addClientFile, { clientId: f.clientId, storageId: f.storageId, filename: "Invoice.pdf", type: "generated" });
  await expect(f.field.mutation(api.field.shareDocument, { clientId: f.clientId, fileId: planId, confirmedNonfinancial: true })).rejects.toThrow(/office|Sign in/);
  await expect(f.office.mutation(api.field.shareDocument, { clientId: f.clientId, fileId: planId, confirmedNonfinancial: false })).rejects.toThrow("Confirm");
  await expect(f.office.mutation(api.field.shareDocument, { clientId: f.clientId, fileId: financialId, confirmedNonfinancial: true })).rejects.toThrow("uploaded plan");
  const sharedId = await f.office.mutation(api.field.shareDocument, { clientId: f.clientId, fileId: planId, confirmedNonfinancial: true });
  expect((await f.field.action(api.field.readFile, { token: f.projectLink.token, id: sharedId })).filename).toBe("Plans.pdf");
  await f.office.mutation(api.field.unshareDocument, { id: sharedId });
  await expect(f.field.action(api.field.readFile, { token: f.projectLink.token, id: sharedId })).rejects.toThrow("no longer available");
});

test("office notifications track field updates, keep read state separate from approval, and isolate workspaces", async () => {
  const f = await fixture();
  const stage = (await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId })).stages[0];
  await f.field.mutation(api.field.reportBlocker, { token: f.projectLink.token, stageId: stage.id, message: "Material delivery delayed" });
  const notifications = await f.office.query(api.field.notifications);
  const issue = notifications.items.find(item => item.type === "blocked")!;
  expect(issue.message).toContain("Material delivery delayed");
  expect(issue.read).toBe(false);
  expect((await f.outsider.query(api.field.notifications)).items).toEqual([]);
  await expect(f.outsider.mutation(api.field.markNotificationsRead, { ids: [issue.id] })).rejects.toThrow("workspace");
  await f.office.mutation(api.field.markNotificationsRead, { ids: [issue.id] });
  expect((await f.office.query(api.field.notifications)).items.find(item => item.id === issue.id)?.read).toBe(true);
  expect((await f.field.query(api.field.getProject, { token: f.projectLink.token, clientId: f.clientId })).stages[0].blocker).toBe("Material delivery delayed");
});

test("malformed photos and expired upload tickets are rejected without registering files", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const task = (await f.t.query(api.field.getProject, { clientId: f.clientId, token })).stages[0].tasks[0];
  const url = new URL(await f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, filename: "fake.png", token }));
  expect((await f.t.fetch(url.pathname + url.search, { method: "POST", headers: { "Content-Type": "image/png" }, body: "not a photo" })).status).toBe(400);
  const expired = new URL(await f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, filename: "expired.png", token }));
  await f.t.run(async ctx => { const ticket = await ctx.db.query("fieldUploadTickets").first(); await ctx.db.patch(ticket!._id, { expiresAt: 1 }); });
  expect((await f.t.fetch(expired.pathname + expired.search, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Blob([png]) })).status).toBe(400);
  expect((await f.t.query(api.field.getProject, { clientId: f.clientId, token })).files).toEqual([]);
});

test("a project link cannot update another project or administrative requirements", async () => {
  const f = await fixture();
  await f.office.mutation(api.field.initializeProject, { clientId: f.unassignedId });
  const token = f.projectLink.token;
  const other = await f.office.query(api.field.getProject, { clientId: f.unassignedId });
  const stage = other.stages[0];
  await expect(f.t.mutation(api.field.setTaskCompleted, { taskId: stage.tasks[0].id, completed: false, token })).rejects.toThrow("access");
  await expect(f.t.mutation(api.field.reportBlocker, { stageId: stage.id, message: "Injected", token })).rejects.toThrow("access");
  await expect(f.t.mutation(api.field.submitStage, { stageId: stage.id, token })).rejects.toThrow("access");
  await expect(f.t.mutation(api.field.createPhotoUpload, { taskId: stage.tasks[0].id, filename: "injected.png", token })).rejects.toThrow("access");
  const own = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  await expect(f.office.mutation(api.field.setTaskCompleted, { taskId: own.stages[0].tasks.find(t => t.kind === "office")!.id, completed: true, token })).rejects.toThrow("office");
});

test("deleting a project removes link access immediately and cleans up photos and activity", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture();
    const view = await f.t.query(api.field.getProject, { clientId: f.clientId, token: f.projectLink.token });
    const photo = await uploadPhoto(f, view.stages[0].tasks[0].id);
    const file = await f.t.run(ctx => ctx.db.get(photo.id));
    await f.office.mutation(api.clients.deleteClient, { clientId: f.clientId });
    expect(await f.t.query(api.field.linkProject, { token: f.projectLink.token })).toBeNull();
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.run(ctx => ctx.db.get(photo.id))).toBeNull();
    expect(await f.t.run(ctx => ctx.storage.get(file!.storageId))).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("fieldProjectLinks").withIndex("by_clientId", q => q.eq("clientId", f.clientId)).first())).toBeNull();
  } finally { vi.useRealTimers(); }
});


test("outstanding upload tickets are bounded and expired tickets are reclaimed", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const task = (await f.t.query(api.field.getProject, { clientId: f.clientId, token })).stages[0].tasks[0];
  for (let i = 0; i < 20; i++) await f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, filename: "pending.png", token });
  await expect(f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, filename: "excess.png", token })).rejects.toThrow("already waiting");
  await f.t.run(async ctx => { const tickets = await ctx.db.query("fieldUploadTickets").withIndex("by_clientId", q => q.eq("clientId", f.clientId)).take(20); for (const ticket of tickets) await ctx.db.patch(ticket._id, { expiresAt: 1 }); });
  await f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, filename: "retry.png", token });
  expect(await f.t.run(ctx => ctx.db.query("fieldUploadTickets").withIndex("by_clientId", q => q.eq("clientId", f.clientId)).take(21))).toHaveLength(1);
});

for (const drawCount of [4, 5, 6] as const) test(`${drawCount}-draw completion work exactly matches the PDF's scheduled descriptions and grouping`, async () => {
  const f = await fixture();
  const schedule = buildDrawSchedule(f.data.lineItems, drawCount);
  const snapshot = drawWorkFromSchedule(schedule, f.data.lineItems);
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId, drawCount,
    drawWorkSchedule: snapshot, files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  const view = await f.t.query(api.field.getProject, { clientId: f.clientId, token: f.projectLink.token });
  const active = view.stages.filter(stage => !stage.archived);
  expect(view.needsScheduleSync).toBe(false);
  expect(active).toHaveLength(drawCount);
  expect(active.map(stage => stage.drawNumber)).toEqual(Array.from({ length: drawCount }, (_, i) => i + 1));
  for (const [index, stage] of active.entries()) {
    const labels = stage.tasks.filter(task => task.kind === "field" && !task.retired).map(task => task.label);
    expect(labels).toEqual((schedule.groups[index] ?? []).map(itemIndex => f.data.lineItems[itemIndex]!.description));
    expect(labels.join(", ")).toBe(drawWorkDescription(snapshot[index]!));
    expect(labels).not.toContain("Profit");
  }
  expect(active[0]!.tasks[0]!.label).toBe("Demolition, debris removal");
  expect(active[drawCount - 1]!.final).toBe(true);
  expect(active[drawCount - 1]!.tasks.filter(task => task.kind === "field" && !task.retired)).toEqual([]);
  const serialized = JSON.stringify(view);
  for (const secret of ["123456", "23456", "PRIVATE-INVOICE", "PRIVATE-CASE", "drawAmounts", "unitPrice", "holdback"]) expect(serialized).not.toContain(secret);
  expect((await f.office.query(api.clients.getClient, { clientId: f.clientId }))?.drawWorkSchedule).toEqual(snapshot);
});

test("older generic stages sync without losing completion checks, photos, or history", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const before = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const oldTask = before.stages[0]!.tasks.find(task => task.kind === "field")!;
  const photo = await uploadPhoto(f, oldTask.id);
  await f.t.run(async ctx => {
    for (const stage of before.stages) await ctx.db.patch(stage.id, { title: `Construction stage ${stage.drawNumber}`, drawNumber: undefined, scheduleKey: undefined });
    await ctx.db.patch(oldTask.id, { label: "Complete the construction work for this stage", scheduleItemKey: undefined, completed: true });
    await ctx.db.patch(before.stages[0]!.id, { status: "verified" });
  });
  const pending = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  expect(pending.needsScheduleSync).toBe(true);
  expect(pending.stages).toEqual([]);
  await expect(f.t.mutation(api.field.syncProjectSchedule, { clientId: f.unassignedId, token })).rejects.toThrow("access");
  await f.t.mutation(api.field.syncProjectSchedule, { clientId: f.clientId, token });
  const after = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const history = after.stages.flatMap(stage => stage.tasks).find(task => task.id === oldTask.id);
  expect(history).toMatchObject({ retired: true, completed: true });
  expect(after.stages[0]!.status).toBe("changes_requested");
  expect(after.files.find(file => file.id === photo.id)?.taskId).toBe(oldTask.id);
  expect((await f.t.action(api.field.readFile, { id: photo.id, token })).bytes.byteLength).toBe(png.byteLength);
  const eventCount = after.activity.length;
  const ids = after.stages.flatMap(stage => stage.tasks.map(task => task.id));
  await f.t.mutation(api.field.syncProjectSchedule, { clientId: f.clientId, token });
  const repeated = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  expect(repeated.activity).toHaveLength(eventCount);
  expect(repeated.stages.flatMap(stage => stage.tasks.map(task => task.id))).toEqual(ids);
  await expect(f.t.mutation(api.field.setTaskCompleted, { taskId: oldTask.id, completed: false, token })).rejects.toThrow("history");
  await expect(f.t.mutation(api.field.createPhotoUpload, { taskId: oldTask.id, filename: "more.png", token })).rejects.toThrow("field requirement");
});

test("regenerating a schedule moves unchanged work and photos to the correct draw while preserving checks", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const oldSchedule = buildDrawSchedule(f.data.lineItems, 4);
  const newSchedule = buildDrawSchedule(f.data.lineItems, 5);
  const movedIndex = newSchedule.groups.flat().find(index => oldSchedule.groups.findIndex(group => group.includes(index)) !== newSchedule.groups.findIndex(group => group.includes(index)))!;
  const before = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const oldStage = before.stages.find(stage => stage.tasks.some(task => task.label === f.data.lineItems[movedIndex]!.description))!;
  const task = oldStage.tasks.find(task => task.label === f.data.lineItems[movedIndex]!.description)!;
  const photo = await uploadPhoto(f, task.id);
  await f.t.mutation(api.field.setTaskCompleted, { taskId: task.id, completed: true, token });
  await f.t.run(ctx => ctx.db.patch(oldStage.id, { status: "verified" }));
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId, drawCount: 5,
    drawWorkSchedule: drawWorkFromSchedule(newSchedule, f.data.lineItems), files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  const after = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const newStage = after.stages.find(stage => stage.tasks.some(row => row.id === task.id))!;
  expect(newStage.drawNumber).toBe(newSchedule.groups.findIndex(group => group.includes(movedIndex)) + 1);
  expect(newStage.id).not.toBe(oldStage.id);
  expect(newStage.tasks.find(row => row.id === task.id)).toMatchObject({ completed: true, retired: false });
  expect(after.files.find(row => row.id === photo.id)?.stageId).toBe(newStage.id);
  expect(after.stages.find(stage => stage.id === oldStage.id)?.status).toBe("changes_requested");
});

test("changed work is unchecked, withdrawn work is retained as history, and surplus draws are archived", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const before = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const oldTask = before.stages[0]!.tasks[0]!;
  const photo = await uploadPhoto(f, oldTask.id);
  await f.t.mutation(api.field.setTaskCompleted, { taskId: oldTask.id, completed: true, token });
  const pendingPhoto = new URL(await f.t.mutation(api.field.createPhotoUpload, { taskId: oldTask.id, filename: "outdated.png", token }));
  const updatedItems = f.data.lineItems.map((item, index) => index === 0 ? { ...item, description: "Revised demolition scope" } : item);
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId, lineItems: updatedItems, drawCount: 6,
    drawWorkSchedule: drawWorkFromSchedule(buildDrawSchedule(updatedItems, 6), updatedItems), files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  const changed = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  expect(changed.stages.flatMap(stage => stage.tasks).find(task => task.id === oldTask.id)).toMatchObject({ retired: true, completed: true });
  expect(changed.stages.flatMap(stage => stage.tasks).find(task => task.label === "Revised demolition scope")).toMatchObject({ retired: false, completed: false });
  expect(changed.files.some(file => file.id === photo.id)).toBe(true);
  expect((await f.t.fetch(pendingPhoto.pathname + pendingPhoto.search, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Blob([png]) })).status).toBe(400);
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId,
    drawWorkSchedule: drawWorkFromSchedule(buildDrawSchedule(f.data.lineItems, 4), f.data.lineItems), files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  const reduced = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  expect(reduced.stages.filter(stage => !stage.archived)).toHaveLength(4);
  expect(reduced.stages.filter(stage => stage.archived)).toHaveLength(2);
  expect((await f.office.query(api.field.listProjects)).find(project => project.id === f.clientId)?.stageCount).toBe(4);
});

test("scheduled construction scope cannot be edited independently and final review requires all earlier draws verified", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const view = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const first = view.stages[0]!;
  const final = view.stages[3]!;
  await expect(f.office.mutation(api.field.addStage, { clientId: f.clientId, title: "Extra stage", instructions: "" })).rejects.toThrow("draw schedule");
  await expect(f.office.mutation(api.field.removeTask, { taskId: first.tasks[0]!.id })).rejects.toThrow("draw schedule");
  await expect(f.office.mutation(api.field.updateStage, { stageId: first.id, title: "Different scope", instructions: "", dueDate: "" })).rejects.toThrow("draw schedule");
  await expect(f.office.mutation(api.field.addTask, { stageId: first.id, label: "Unscheduled work", kind: "field", requiresPhoto: false })).rejects.toThrow("draw schedule");
  await f.office.mutation(api.field.addTask, { stageId: first.id, label: "Permit inspection approved", kind: "office", requiresPhoto: false });
  await expect(f.t.mutation(api.field.submitStage, { stageId: final.id, token })).rejects.toThrow("earlier draws");
  await f.t.run(async ctx => { for (const stage of view.stages.slice(0, -1)) await ctx.db.patch(stage.id, { status: "verified" }); });
  await f.t.mutation(api.field.submitStage, { stageId: final.id, token });
  await f.office.mutation(api.field.reviewStage, { stageId: final.id, decision: "verified", note: "Final work reviewed" });
  expect((await f.t.query(api.field.getProject, { clientId: f.clientId, token })).stages[3]!.status).toBe("verified");
  const changedItems = f.data.lineItems.map((item, index) => index === 0 ? { ...item, description: "Updated demolition work" } : item);
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId, lineItems: changedItems,
    drawWorkSchedule: drawWorkFromSchedule(buildDrawSchedule(changedItems, 4), changedItems), files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  expect((await f.t.query(api.field.getProject, { clientId: f.clientId, token })).stages[3]!.status).toBe("changes_requested");
  await expect(f.t.mutation(api.field.submitStage, { stageId: final.id, token })).rejects.toThrow("earlier draws");
});

test("saved packet work remains the source of truth and invalid legacy schedule errors expose no financial data", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId,
    drawWorkSchedule: drawWorkFromSchedule(buildDrawSchedule(f.data.lineItems, 4), f.data.lineItems), files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  await f.t.run(ctx => ctx.db.patch(f.clientId, { lineItems: [{ description: "Not issued in the packet", qty: 1, unitPrice: 123456, amount: 123456 }] }));
  const saved = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  expect(saved.needsScheduleSync).toBe(false);
  expect(saved.stages[0]!.tasks[0]!.label).toBe("Demolition, debris removal");
  await f.t.run(ctx => ctx.db.patch(f.clientId, { drawWorkSchedule: undefined }));
  const unavailable = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  expect(unavailable.scheduleError).toContain("draw schedule is unavailable");
  expect(unavailable.scheduleError).not.toContain("123456");
  expect(unavailable.scheduleError).not.toContain("$");
  expect(unavailable.stages).toEqual([]);
  await expect(f.t.mutation(api.field.syncProjectSchedule, { clientId: f.clientId, token })).rejects.toThrow("draw schedule is unavailable");
});

test.each([4, 5, 6] as const)("GC portal excludes office-only line items without regrouping the %i-draw packet", async drawCount => {
  const f = await fixture();
  const descriptions: Record<number, string> = { 0: "Plan and Spec Job", 1: "Builder's Risk INSURANCE", 3: "General liability coverage" };
  const lineItems = f.data.lineItems.map((item, index) => ({ ...item, description: descriptions[index] ?? item.description }));
  const schedule = buildDrawSchedule(lineItems, drawCount);
  const packetWork = drawWorkFromSchedule(schedule, lineItems);
  await f.office.mutation(internal.clients.saveGeneratedPacket, { ...f.data, replaceClientId: f.clientId, lineItems, drawCount,
    drawWorkSchedule: packetWork, files: [{ storageId: f.storageId, filename: "Packet.pdf" }] });
  const view = await f.t.query(api.field.getProject, { clientId: f.clientId, token: f.projectLink.token });
  expect(view.needsScheduleSync).toBe(false);
  expect(view.stages.filter(stage => !stage.archived).map(stage => stage.tasks.filter(task => task.kind === "field" && !task.retired).map(task => task.label)))
    .toEqual(packetWork.map(draw => draw.items.filter(item => ![0, 1, 3].includes(item.lineItemIndex)).map(item => item.description)));
  for (const description of Object.values(descriptions)) expect(JSON.stringify(view)).not.toContain(description);
  const saved = await f.t.run(ctx => ctx.db.get(f.clientId));
  expect(saved!.drawWorkSchedule).toEqual(packetWork);
  expect(saved!.lineItems).toEqual(lineItems);
  expect(buildDrawSchedule(saved!.lineItems, drawCount)).toEqual(schedule);
  // A draw containing only office work still supports submission and review.
  const emptyDraw = view.stages.find(stage => !stage.archived && !stage.final && !stage.tasks.some(task => task.kind === "field" && !task.retired));
  expect(emptyDraw).toBeDefined();
  await f.t.mutation(api.field.submitStage, { stageId: emptyDraw!.id, token: f.projectLink.token });
  await f.office.mutation(api.field.reviewStage, { stageId: emptyDraw!.id, decision: "verified", note: "Office requirements reviewed" });
});

test("excluded legacy work, its photos, and activity stay private before and after schedule synchronization", async () => {
  const f = await fixture();
  const token = f.projectLink.token;
  const original = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
  const task = original.stages[0]!.tasks.find(task => task.kind === "field")!;
  const photo = await uploadPhoto(f, task.id);
  const pending = new URL(await f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, token, filename: "pending.png" }));
  const lineItems = f.data.lineItems.map((item, index) => index === 0 ? { ...item, description: "Plan & Spec Job" } : item);
  const fullWork = drawWorkFromSchedule(buildDrawSchedule(lineItems, 4), lineItems);
  await f.t.run(async ctx => {
    await ctx.db.patch(f.clientId, { lineItems, drawWorkSchedule: fullWork });
    await ctx.db.patch(task.id, { label: "Plan & Spec Job", scheduleItemKey: JSON.stringify([0, "Plan & Spec Job"]) });
    for (const message of ["Completed: Plan & Spec Job", "Added requirement: Insurance policy", "Completed: LIABILITY coverage"]) {
      await ctx.db.insert("projectActivity", { clientId: f.clientId, workspaceId: f.workspaceId, actorId: "legacy", actorName: "Office", type: "task_updated", message, createdAt: Date.now() });
    }
  });
  for (const synchronized of [false, true]) {
    if (synchronized) await f.t.mutation(api.field.syncProjectSchedule, { clientId: f.clientId, token });
    const guest = await f.t.query(api.field.getProject, { clientId: f.clientId, token });
    expect(guest.needsScheduleSync).toBe(!synchronized);
    expect(guest.stages.flatMap(stage => stage.tasks).some(row => row.id === task.id)).toBe(false);
    expect(guest.files.some(file => file.id === photo.id)).toBe(false);
    expect(JSON.stringify(guest)).not.toMatch(/plan & spec job|insurance|liability/i);
    await expect(f.t.action(api.field.readFile, { id: photo.id, token })).rejects.toThrow("no longer available");
    await expect(f.office.action(api.field.readFile, { id: photo.id, token })).rejects.toThrow("no longer available");
    await expect(f.t.mutation(api.field.setTaskCompleted, { taskId: task.id, completed: true, token })).rejects.toThrow("not available");
    await expect(f.t.mutation(api.field.createPhotoUpload, { taskId: task.id, filename: "new.png", token })).rejects.toThrow();
    expect((await f.office.action(api.field.readFile, { id: photo.id })).bytes.byteLength).toBe(png.byteLength);
    const office = await f.office.query(api.field.getProject, { clientId: f.clientId });
    expect(office.files.some(file => file.id === photo.id)).toBe(true);
    expect(office.activity.some(event => event.message.includes("Plan & Spec Job"))).toBe(true);
  }
  const office = await f.office.query(api.field.getProject, { clientId: f.clientId });
  expect(office.stages.flatMap(stage => stage.tasks).find(row => row.id === task.id)).toMatchObject({ retired: true });
  expect((await f.t.fetch(pending.pathname + pending.search, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Blob([png]) })).status).toBe(400);
});
