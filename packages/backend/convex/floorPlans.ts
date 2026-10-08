import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { blankPlan, parsePlan, type Plan } from "./lib/floorPlanModel";
import { resolvePlanStages, type PlanStage, type SavedPlanStage } from "./lib/planStages";
import { assertWorkspace } from "./lib/workspaces";

const stageValidator = v.union(v.literal("before"), v.literal("after"));
const savedStageValidator = v.union(stageValidator, v.literal("archive"));
const summaryValidator = v.object({
  id: v.id("floorPlans"), clientId: v.id("clients"), clientName: v.string(),
  stage: savedStageValidator, draftId: v.string(), name: v.string(), revision: v.number(), updatedAt: v.number(),
  wallCount: v.number(), fixtureCount: v.number(),
});
const clientInput = v.object({
  name: v.string(), street: v.string(), city: v.string(), state: v.string(), zip: v.string(),
  phone: v.string(), caseNumber: v.string(), drawCount: v.union(v.literal(4), v.literal(5), v.literal(6)),
});
function validateDocument(document: string): Plan {
  if (new TextEncoder().encode(document).byteLength > 750_000)
    throw new ConvexError("This plan is too large to save. Keep the backup and reduce the number of elements.");
  try { return parsePlan(JSON.parse(document)); }
  catch { throw new ConvexError("This is not a valid floor-plan document."); }
}
function summary(p: Doc<"floorPlans">, clientName: string, stage: SavedPlanStage) {
  return { stage, id: p._id, clientId: p.clientId, clientName, draftId: p.draftId, name: p.name,
    revision: p.revision, updatedAt: p.updatedAt, wallCount: p.wallCount, fixtureCount: p.fixtureCount };
}
async function currentPlan(ctx: MutationCtx, workspaceId: Id<"workspaces"> | undefined, draftId: string) {
  return ctx.db.query("floorPlans").withIndex("by_workspaceId_and_draftId", q => q.eq("workspaceId", workspaceId).eq("draftId", draftId)).unique();
}
function checkRevision(existing: Doc<"floorPlans"> | null, revision: number) {
  if (!Number.isInteger(revision) || revision < 0) throw new ConvexError("Invalid plan revision.");
  if ((existing?.revision ?? 0) !== revision) throw new ConvexError({ code: "CONFLICT", message: "A newer version of this plan is saved. Open the saved version from My plans, or duplicate your draft to save a separate copy." });
}
async function requireClient(ctx: QueryCtx | MutationCtx, clientId: Id<"clients">, workspaceId: Id<"workspaces"> | undefined) {
  const client = await ctx.db.get(clientId); assertWorkspace(client, workspaceId);
  return client!;
}
async function clientRecords(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces"> | undefined, clientId: Id<"clients">) {
  return ctx.db.query("floorPlans").withIndex("by_workspaceId_and_clientId_and_updatedAt", q => q.eq("workspaceId", workspaceId).eq("clientId", clientId)).take(101);
}
async function persistStages(ctx: MutationCtx, records: Doc<"floorPlans">[]) {
  const stages = resolvePlanStages(records);
  for (const record of records) if (record.stage !== stages.get(record._id)) await ctx.db.patch(record._id, { stage: stages.get(record._id)! });
  return stages;
}
async function recordStage(ctx: QueryCtx | MutationCtx, record: Doc<"floorPlans">) {
  return resolvePlanStages(await clientRecords(ctx, record.workspaceId, record.clientId)).get(record._id)!;
}
async function assertStage(ctx: MutationCtx, workspaceId: Id<"workspaces"> | undefined, clientId: Id<"clients">, stage: SavedPlanStage, existing: Doc<"floorPlans"> | null) {
  if (existing) {
    const originalStage = await recordStage(ctx, existing);
    if (stage !== originalStage) throw new ConvexError("A saved plan keeps its Before or After stage. Open the other stage to edit it.");
    if (existing.clientId !== clientId) {
      const originalRecords = await clientRecords(ctx, workspaceId, existing.clientId);
      const originalStages = resolvePlanStages(originalRecords);
      if (originalStage !== "before" || originalRecords.some(p => originalStages.get(p._id) === "after"))
        throw new ConvexError("Keep the Before and After plans with the same client. Duplicate a local draft to start another client's Before plan.");
      await persistStages(ctx, originalRecords);
    }
  }
  const records = await clientRecords(ctx, workspaceId, clientId), stages = resolvePlanStages(records);
  if (stage !== "archive" && records.some(p => p._id !== existing?._id && stages.get(p._id) === stage))
    throw new ConvexError(`This client already has ${stage === "before" ? "a Before" : "an After"} plan. Open it from the client's floor plans to continue editing.`);
  if (stage === "after" && !records.some(p => stages.get(p._id) === "before" && ((existing && existing.clientId === clientId) || p.wallCount > 0)))
    throw new ConvexError("Draw and save the Before plan first, then start the After plan.");
  await persistStages(ctx, records);
}
async function saveDocument(ctx: MutationCtx, workspaceId: Id<"workspaces"> | undefined, client: Doc<"clients">, plan: Plan, document: string, existing: Doc<"floorPlans"> | null, stage: SavedPlanStage, requestId?: string) {
  const now = Date.now();
  const data = { clientId: client._id, stage, name: plan.name, document, wallCount: plan.walls.length,
    fixtureCount: plan.fixtures.length, revision: (existing?.revision ?? 0) + 1, updatedAt: now,
    ...(requestId ? { clientCreationRequestId: requestId } : {}),
  };
  const planId = existing ? existing._id : await ctx.db.insert("floorPlans", { ...data, workspaceId, draftId: plan.id, createdAt: now });
  if (existing) await ctx.db.patch(existing._id, data);
  await ctx.db.patch(client._id, { updatedAt: now });
  if (existing && existing.clientId !== client._id) {
    const oldClient = await ctx.db.get(existing.clientId);
    if (oldClient && oldClient.workspaceId === workspaceId) await ctx.db.patch(oldClient._id, { updatedAt: now });
  }
  return summary((await ctx.db.get(planId))!, client.name, stage);
}

export const listClients = query({
  args: {},
  returns: v.array(v.object({ id: v.id("clients"), name: v.string(), street: v.string(), city: v.string(), state: v.string(), caseNumber: v.string() })),
  handler: async ctx => {
    const workspaceId = await requireAuth(ctx);
    const clients = await ctx.db.query("clients").withIndex("by_workspaceId_and_createdAt", q => q.eq("workspaceId", workspaceId)).order("desc").take(1000);
    return clients.map(c => ({ id: c._id, name: c.name, street: c.street, city: c.city, state: c.state, caseNumber: c.caseNumber ?? "" }));
  },
});
export const list = query({
  args: { clientId: v.optional(v.id("clients")) }, returns: v.array(summaryValidator),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    if (args.clientId) await requireClient(ctx, args.clientId, workspaceId);
    const records = args.clientId
      ? await ctx.db.query("floorPlans").withIndex("by_workspaceId_and_clientId_and_updatedAt", q => q.eq("workspaceId", workspaceId).eq("clientId", args.clientId!)).order("desc").take(100)
      : await ctx.db.query("floorPlans").withIndex("by_workspaceId_and_updatedAt", q => q.eq("workspaceId", workspaceId)).order("desc").take(1000);
    const names = new Map<Id<"clients">, string>(), stages = new Map<string, SavedPlanStage>();
    for (const clientId of new Set(records.map(r => r.clientId))) {
      const client = await ctx.db.get(clientId);
      if (client && client.workspaceId === workspaceId) {
        names.set(clientId, client.name);
        for (const [id, stage] of resolvePlanStages(await clientRecords(ctx, workspaceId, clientId))) stages.set(id, stage);
      }
    }
    return records.filter(r => names.has(r.clientId)).map(r => summary(r, names.get(r.clientId)!, stages.get(r._id)!));
  },
});
export const get = query({
  args: { id: v.id("floorPlans") }, returns: v.object({ summary: summaryValidator, document: v.string() }),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx), record = await ctx.db.get(args.id);
    assertWorkspace(record, workspaceId);
    const client = await requireClient(ctx, record!.clientId, workspaceId);
    return { summary: summary(record!, client.name, await recordStage(ctx, record!)), document: record!.document };
  },
});
export const save = mutation({
  args: { clientId: v.id("clients"), document: v.string(), expectedRevision: v.number(), stage: v.optional(stageValidator) }, returns: summaryValidator,
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx), client = await requireClient(ctx, args.clientId, workspaceId);
    const plan = validateDocument(args.document), existing = await currentPlan(ctx, workspaceId, plan.id);
    const stage = args.stage ?? (existing ? await recordStage(ctx, existing) : "before");
    await assertStage(ctx, workspaceId, args.clientId, stage, existing);
    if (existing?.document === args.document && existing.clientId === args.clientId) return summary(existing, client.name, stage);
    checkRevision(existing, args.expectedRevision);
    return saveDocument(ctx, workspaceId, client, plan, args.document, existing, stage);
  },
});
export const saveToNewClient = mutation({
  args: { client: clientInput, document: v.string(), expectedRevision: v.number(), requestId: v.string() }, returns: summaryValidator,
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx), plan = validateDocument(args.document);
    const existing = await currentPlan(ctx, workspaceId, plan.id);
    if (!args.requestId || args.requestId.length > 100) throw new ConvexError("Invalid save request.");
    if (existing?.clientCreationRequestId === args.requestId && existing.document === args.document) {
      const client = await requireClient(ctx, existing.clientId, workspaceId);
      return summary(existing, client.name, await recordStage(ctx, existing));
    }
    checkRevision(existing, args.expectedRevision);
    const data = { ...args.client };
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      if (key === "drawCount") continue;
      const text = (data[key] as string).trim();
      if (text.length > (key === "name" || key === "street" ? 160 : 80)) throw new ConvexError("Client details are too long.");
      (data as Record<string, unknown>)[key] = text;
    }
    if (!data.name) throw new ConvexError("Enter a client name.");
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", { ...data, workspaceId, invoiceNumber: "", lineItems: [], subtotal: 0, total: 0, status: "unsigned", createdAt: now, updatedAt: now });
    await assertStage(ctx, workspaceId, clientId, "before", existing);
    return saveDocument(ctx, workspaceId, (await ctx.db.get(clientId))!, plan, args.document, existing, "before", args.requestId);
  },
});
// Starting a stage is transactional and idempotent: concurrent clicks/devices
// reopen the same record. After copies a saved Before snapshot exactly once.
export const start = mutation({
  args: { clientId: v.id("clients"), stage: stageValidator, expectedBeforeRevision: v.optional(v.number()) },
  returns: v.object({ summary: summaryValidator, document: v.string() }),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx), client = await requireClient(ctx, args.clientId, workspaceId);
    const records = await clientRecords(ctx, workspaceId, args.clientId), stages = await persistStages(ctx, records);
    const existing = records.find(p => stages.get(p._id) === args.stage);
    if (existing) return { summary: summary(existing, client.name, args.stage), document: existing.document };
    const before = records.find(p => stages.get(p._id) === "before");
    if (args.stage === "after") {
      if (!before || before.wallCount === 0) throw new ConvexError("Draw and save the Before plan first, then start the After plan.");
      if (args.expectedBeforeRevision !== undefined) checkRevision(before, args.expectedBeforeRevision);
    }
    const title = args.stage === "before" ? "Before" : "After";
    const draftId = `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const source = args.stage === "after" ? validateDocument(before!.document) : blankPlan(`${client.name.slice(0, 140)} — Before`, draftId);
    const plan = { ...source, id: draftId, name: args.stage === "after" ? `${source.name.replace(/\s*[—-]\s*Before$/i, "").slice(0, 148)} — ${title}` : source.name, updatedAt: Date.now() };
    const document = JSON.stringify(plan);
    const saved = await saveDocument(ctx, workspaceId, client, plan, document, null, args.stage);
    return { summary: saved, document };
  },
});

export const remove = mutation({
  args: { id: v.id("floorPlans") }, returns: v.null(),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx), record = await ctx.db.get(args.id);
    assertWorkspace(record, workspaceId);
    const records = await clientRecords(ctx, workspaceId, record!.clientId), stages = resolvePlanStages(records);
    if (stages.get(args.id) === "before" && records.some(p => stages.get(p._id) === "after"))
      throw new ConvexError("Delete the After plan first to keep the client's Before and After workflow intact.");
    await persistStages(ctx, records);
    await ctx.db.delete(args.id);
    const client = await ctx.db.get(record!.clientId);
    if (client && client.workspaceId === workspaceId) await ctx.db.patch(client._id, { updatedAt: Date.now() });
    return null;
  },
});
