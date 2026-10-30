import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { requireAuth } from "./lib/auth";
import { assertWorkspace, currentMembership } from "./lib/workspaces";
import { activity, cleanText, editableStage, hashToken, projectAccess, projectActor, projectLink, publicProject, stageAccess } from "./lib/fieldAccess";
import { requireCurrentSchedule, scheduleNeedsSync, synchronizeDrawStages } from "./lib/fieldSchedule";
import { isOfficeOnlyDrawWork } from "./lib/drawWorkSchedule";
import schema, { fieldStageStatus } from "./schema";

const projectValidator = v.object({ id: v.id("clients"), name: v.string(), address: v.string() });
const taskValidator = v.object({ id: v.id("projectTasks"), label: v.string(), kind: v.union(v.literal("field"), v.literal("office")), requiresPhoto: v.boolean(), completed: v.boolean(), retired: v.boolean(), scheduled: v.boolean() });
const stageValidator = v.object({
  id: v.id("projectStages"), title: v.string(), instructions: v.string(), status: fieldStageStatus,
  dueDate: v.union(v.string(), v.null()), blocker: v.union(v.string(), v.null()), reviewNote: v.union(v.string(), v.null()),
  tasks: v.array(taskValidator), drawNumber: v.union(v.number(), v.null()), final: v.boolean(), archived: v.boolean(),
});
const fileValidator = v.object({ id: v.id("projectFiles"), taskId: v.union(v.id("projectTasks"), v.null()), stageId: v.union(v.id("projectStages"), v.null()),
  filename: v.string(), kind: v.union(v.literal("photo"), v.literal("document")), uploadedByName: v.string(), createdAt: v.number() });
const activityValidator = v.object({ id: v.id("projectActivity"), actorName: v.string(), message: v.string(), type: v.string(), createdAt: v.number(), stageId: v.union(v.id("projectStages"), v.null()) });
const activityView = (row: Doc<"projectActivity">) => ({ id: row._id, actorName: row.actorName, message: row.message, type: row.type, createdAt: row.createdAt, stageId: row.stageId ?? null });

export const current = query({
  args: {}, returns: v.union(v.null(), v.object({ mode: v.union(v.literal("office"), v.literal("unassigned")), name: v.string() })),
  handler: async ctx => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    if (await currentMembership(ctx)) return { mode: "office" as const, name: user.name };
    return { mode: "unassigned" as const, name: user.name };
  },
});

async function stages(ctx: QueryCtx | MutationCtx, clientId: Id<"clients">) {
  return ctx.db.query("projectStages").withIndex("by_clientId_and_order", q => q.eq("clientId", clientId)).take(20);
}
async function tasks(ctx: QueryCtx | MutationCtx, stageId: Id<"projectStages">) {
  return ctx.db.query("projectTasks").withIndex("by_stageId_and_order", q => q.eq("stageId", stageId)).take(1201);
}
async function officeProject(ctx: QueryCtx | MutationCtx, clientId: Id<"clients">) {
  const access = await projectAccess(ctx, clientId);
  if (!access.actor.office) throw new ConvexError("Only the office can manage this setting.");
  return access;
}
async function ensureStages(ctx: MutationCtx, client: Doc<"clients">) { return synchronizeDrawStages(ctx, client); }

export const syncProjectSchedule = mutation({
  args: { clientId: v.id("clients"), token: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { client } = await projectAccess(ctx, args.clientId, args.token);
    await synchronizeDrawStages(ctx, client);
    return null;
  },
});

export const initializeProject = mutation({
  args: { clientId: v.id("clients") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { client, actor } = await officeProject(ctx, args.clientId);
    if (await ensureStages(ctx, client)) await activity(ctx, client, actor, "project_setup", "Project checklists match the draw schedule.");
    return null;
  },
});

export const listProjects = query({
  args: {}, returns: v.array(v.object({ ...projectValidator.fields, stageCount: v.number(), verifiedCount: v.number(), submittedCount: v.number(), blockerCount: v.number(), nextStage: v.union(v.string(), v.null()), updatedAt: v.number() })),
  handler: async ctx => {
    const actor = await projectActor(ctx);
    if (!actor.office) throw new ConvexError("Use your project link to open a project.");
    const clients = await ctx.db.query("clients").withIndex("by_workspaceId_and_createdAt", q => q.eq("workspaceId", actor.member.workspaceId)).order("desc").take(100);
    const result = await Promise.all(clients.map(async client => {
      const list = (await stages(ctx, client._id)).filter(stage => !stage.archived);
      return { ...publicProject(client), stageCount: list.length, verifiedCount: list.filter(s => s.status === "verified").length,
        submittedCount: list.filter(s => s.status === "submitted").length, blockerCount: list.filter(s => !!s.blocker).length,
        nextStage: list.find(s => s.status !== "verified")?.title ?? null, updatedAt: Math.max(client.updatedAt, ...list.map(s => s.updatedAt)) };
    }));
    return result.filter(row => row.stageCount > 0).sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getProject = query({
  args: { clientId: v.id("clients"), token: v.optional(v.string()) },
  returns: v.object({ project: projectValidator, office: v.boolean(), needsScheduleSync: v.boolean(), scheduleError: v.union(v.string(), v.null()), stages: v.array(stageValidator), files: v.array(fileValidator), activity: v.array(activityValidator) }),
  handler: async (ctx, args) => {
    const { client, actor } = await projectAccess(ctx, args.clientId, args.token);
    const list = await stages(ctx, client._id);
    let needsScheduleSync = true;
    let scheduleError: string | null = null;
    try { needsScheduleSync = scheduleNeedsSync(client, list); }
    catch (error) { if (error instanceof ConvexError && typeof error.data === "string") scheduleError = error.data; else throw error; }
    const [files, events, stageTasks] = await Promise.all([
      ctx.db.query("projectFiles").withIndex("by_clientId", q => q.eq("clientId", client._id)).order("desc").take(200),
      ctx.db.query("projectActivity").withIndex("by_clientId_and_createdAt", q => q.eq("clientId", client._id)).order("desc").take(30),
      Promise.all(list.map(s => tasks(ctx, s._id))),
    ]);
    const visibleTaskIds = new Set(stageTasks.flat().filter(task => actor.office || !isOfficeOnlyDrawWork(task.label)).map(task => task._id));
    const stageViews = list.map((s, index) => ({ id: s._id, title: s.title, instructions: s.instructions, status: s.status,
        drawNumber: s.drawNumber ?? null, final: s.drawNumber === client.drawCount, archived: !!s.archived, dueDate: s.dueDate ?? null, blocker: s.blocker ?? null, reviewNote: s.reviewNote ?? null,
        tasks: stageTasks[index]!.filter(t => visibleTaskIds.has(t._id)).map(t => ({ id: t._id, label: t.label, kind: t.kind, requiresPhoto: t.requiresPhoto, completed: t.completed, retired: !!t.retired, scheduled: !!t.scheduleItemKey })) }));
    // Deliberate allowlist: no client totals, line items, case numbers, packet
    // IDs, storage IDs, direct file URLs, or financial documents leave here.
    return { project: publicProject(client), office: actor.office, needsScheduleSync, scheduleError, stages: needsScheduleSync ? [] : stageViews,
      files: files.filter(f => actor.office || !f.taskId || visibleTaskIds.has(f.taskId)).map(f => ({ id: f._id, taskId: f.taskId ?? null, stageId: f.stageId ?? null, filename: f.filename, kind: f.kind, uploadedByName: f.uploadedByName, createdAt: f.createdAt })),
      activity: events.filter(event => actor.office || !isOfficeOnlyDrawWork(event.message)).map(activityView) };
  },
});

// Project links are bearer credentials. Only their SHA-256 hashes are stored.
export const createProjectLink = mutation({
  args: { clientId: v.id("clients"), label: v.string() }, returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const { client, actor } = await officeProject(ctx, args.clientId);
    const label = cleanText(args.label, "Field GC or company name", 120);
    const previous = await ctx.db.query("fieldProjectLinks").withIndex("by_clientId", q => q.eq("clientId", client._id)).take(100);
    for (const link of previous) {
      if (link.revokedAt) await ctx.db.delete(link._id);
      else await ctx.db.patch(link._id, { revokedAt: Date.now() });
    }
    await ensureStages(ctx, client);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    await ctx.db.insert("fieldProjectLinks", { workspaceId: client.workspaceId, clientId: client._id, label, tokenHash: await hashToken(token), createdAt: Date.now() });
    await activity(ctx, client, actor, "project_link_created", "Field GC project access link created. Earlier links no longer work.");
    return { token };
  },
});

export const linkProject = query({
  args: { token: v.string() }, returns: v.union(v.null(), v.object({ project: projectValidator, label: v.string() })),
  handler: async (ctx, args) => {
    try {
      const link = await projectLink(ctx, args.token);
      const client = await ctx.db.get(link.clientId);
      return client ? { project: publicProject(client), label: link.label } : null;
    } catch (error) { if (error instanceof ConvexError) return null; throw error; }
  },
});

export const projectTeam = query({
  args: { clientId: v.id("clients") },
  returns: v.object({ link: v.union(v.null(), v.object({ id: v.id("fieldProjectLinks"), label: v.string(), createdAt: v.number() })) }),
  handler: async (ctx, args) => {
    await officeProject(ctx, args.clientId);
    const links = await ctx.db.query("fieldProjectLinks").withIndex("by_clientId", q => q.eq("clientId", args.clientId)).order("desc").take(100);
    const link = links.find(link => !link.revokedAt);
    return { link: link ? { id: link._id, label: link.label, createdAt: link.createdAt } : null };
  },
});

export const revokeProjectLink = mutation({
  args: { id: v.id("fieldProjectLinks") }, returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.id);
    if (!link) throw new ConvexError("Project link not found.");
    const { client, actor } = await officeProject(ctx, link.clientId);
    await ctx.db.patch(link._id, { revokedAt: Date.now() });
    await activity(ctx, client, actor, "access_removed", "Field GC project link revoked.");
    return null;
  },
});

export const addStage = mutation({
  args: { clientId: v.id("clients"), title: v.string(), instructions: v.string(), dueDate: v.optional(v.string()) }, returns: v.id("projectStages"),
  handler: async (ctx, args) => {
    await officeProject(ctx, args.clientId);
    throw new ConvexError("Completion stages come from the draw schedule. Regenerate the packet to change them.");
  },
});

export const updateStage = mutation({
  args: { stageId: v.id("projectStages"), title: v.string(), instructions: v.string(), dueDate: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { stage } = await stageAccess(ctx, args.stageId);
    const { client, actor } = await officeProject(ctx, stage.clientId);
    editableStage(stage);
    if (stage.archived || args.title !== stage.title) throw new ConvexError("Stage names come from the draw schedule and cannot be changed here.");
    if (args.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) throw new ConvexError("Enter a valid due date.");
    await ctx.db.patch(stage._id, { title: cleanText(args.title, "Stage name", 120), instructions: cleanText(args.instructions, "Instructions", 3000, false), dueDate: args.dueDate || undefined, updatedAt: Date.now() });
    await activity(ctx, client, actor, "stage_updated", "Stage instructions were updated.", stage._id);
    return null;
  },
});

export const addTask = mutation({
  args: { stageId: v.id("projectStages"), label: v.string(), kind: v.union(v.literal("field"), v.literal("office")), requiresPhoto: v.boolean() }, returns: v.id("projectTasks"),
  handler: async (ctx, args) => {
    const { stage } = await stageAccess(ctx, args.stageId);
    const { client, actor } = await officeProject(ctx, stage.clientId);
    editableStage(stage);
    if (stage.archived || args.kind !== "office") throw new ConvexError("Construction requirements come from the draw schedule. Only office requirements can be added here.");
    const list = await tasks(ctx, stage._id);
    if (list.length >= 50) throw new ConvexError("A stage can have at most 50 requirements.");
    const label = cleanText(args.label, "Requirement", 240);
    const id = await ctx.db.insert("projectTasks", { stageId: stage._id, clientId: client._id, label, kind: args.kind, requiresPhoto: false,
      order: list.reduce((max, t) => Math.max(max, t.order), -1) + 1, completed: false, updatedAt: Date.now() });
    await activity(ctx, client, actor, "task_added", `Added requirement: ${label}`, stage._id);
    return id;
  },
});

export const removeTask = mutation({
  args: { taskId: v.id("projectTasks") }, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError("Requirement not found.");
    const { stage } = await stageAccess(ctx, task.stageId);
    const { client, actor } = await officeProject(ctx, stage.clientId);
    editableStage(stage);
    if (task.scheduleItemKey || task.retired || stage.archived) throw new ConvexError("Work from the draw schedule and its earlier evidence cannot be removed here.");
    const files = await ctx.db.query("projectFiles").withIndex("by_taskId", q => q.eq("taskId", task._id)).take(1);
    if (files.length) throw new ConvexError("This requirement has evidence attached. Keep it to preserve the project record.");
    await ctx.db.delete(task._id);
    await activity(ctx, client, actor, "task_removed", `Removed requirement: ${task.label}`, stage._id);
    return null;
  },
});

export const setTaskCompleted = mutation({
  args: { taskId: v.id("projectTasks"), completed: v.boolean(), token: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError("Requirement not found.");
    const { client, stage, actor } = await stageAccess(ctx, task.stageId, args.token);
    if (!actor.office && isOfficeOnlyDrawWork(task.label)) throw new ConvexError("Requirement is not available in the field portal.");
    await requireCurrentSchedule(ctx, client);
    if (stage.archived || task.retired) throw new ConvexError("This requirement is kept as earlier project history and cannot be changed.");
    if (task.kind === "office" && !actor.office) throw new ConvexError("Only the office can update this requirement.");
    if (task.kind === "field") editableStage(stage);
    if (task.completed === args.completed) return null;
    if (args.completed && task.requiresPhoto) {
      const evidence = await ctx.db.query("projectFiles").withIndex("by_taskId", q => q.eq("taskId", task._id)).take(1);
      if (!evidence.length) throw new ConvexError("Upload a completion photo before checking off this requirement.");
    }
    await ctx.db.patch(task._id, { completed: args.completed, completedBy: args.completed ? actor.authUserId : undefined, updatedAt: Date.now() });
    await ctx.db.patch(stage._id, { status: stage.status === "not_started" ? "in_progress" : stage.status, updatedAt: Date.now() });
    await activity(ctx, client, actor, "task_updated", `${args.completed ? "Completed" : "Reopened"}: ${task.label}`, stage._id);
    return null;
  },
});

export const reportBlocker = mutation({
  args: { stageId: v.id("projectStages"), message: v.string(), token: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { client, actor, stage } = await stageAccess(ctx, args.stageId, args.token);
    await requireCurrentSchedule(ctx, client);
    if (stage.archived) throw new ConvexError("This stage is kept as earlier project history.");
    editableStage(stage);
    const blocker = cleanText(args.message, "Issue", 1000, false);
    await ctx.db.patch(stage._id, { blocker: blocker || undefined, status: stage.status === "not_started" ? "in_progress" : stage.status, updatedAt: Date.now() });
    await activity(ctx, client, actor, blocker ? "blocked" : "blocker_resolved", blocker ? `Reported a blocker: ${blocker}` : "Resolved the stage blocker.", stage._id);
    return null;
  },
});

async function checkFieldRequirements(ctx: QueryCtx | MutationCtx, stage: Doc<"projectStages">, client: Doc<"clients">) {
  await requireCurrentSchedule(ctx, client);
  if (stage.archived) throw new ConvexError("This stage is kept as earlier project history.");
  if (stage.blocker) throw new ConvexError("Resolve the blocker before submitting this stage.");
  if (stage.drawNumber === client.drawCount) {
    const earlier = (await stages(ctx, client._id)).filter(s => !s.archived && s.drawNumber! < client.drawCount);
    if (earlier.length !== client.drawCount - 1 || earlier.some(s => s.status !== "verified")) throw new ConvexError("The office must verify all earlier draws before final review.");
    return;
  }
  const fieldTasks = (await tasks(ctx, stage._id)).filter(t => t.kind === "field" && !t.retired);
  if (fieldTasks.some(t => !t.completed)) throw new ConvexError("Complete all field requirements before submitting this stage.");
  for (const task of fieldTasks) if (task.requiresPhoto) {
    if (!(await ctx.db.query("projectFiles").withIndex("by_taskId", q => q.eq("taskId", task._id)).take(1)).length) throw new ConvexError("Completion photos are required.");
  }
  if (stage.blocker) throw new ConvexError("Resolve the blocker before submitting this stage.");
}

export const submitStage = mutation({
  args: { stageId: v.id("projectStages"), token: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { stage, client, actor } = await stageAccess(ctx, args.stageId, args.token);
    editableStage(stage);
    await checkFieldRequirements(ctx, stage, client);
    await ctx.db.patch(stage._id, { status: "submitted", reviewNote: undefined, updatedAt: Date.now() });
    await activity(ctx, client, actor, "stage_submitted", `${stage.title} submitted for office review.`, stage._id);
    return null;
  },
});

export const reviewStage = mutation({
  args: { stageId: v.id("projectStages"), decision: v.union(v.literal("verified"), v.literal("changes_requested")), note: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { stage } = await stageAccess(ctx, args.stageId);
    const { client, actor } = await officeProject(ctx, stage.clientId);
    if (stage.archived) throw new ConvexError("This stage is kept as earlier project history.");
    if (stage.status !== "submitted" && !(stage.status === "verified" && args.decision === "changes_requested")) throw new ConvexError("This stage is not awaiting review.");
    const reviewNote = cleanText(args.note, "Review note", 1000, args.decision === "changes_requested");
    if (args.decision === "verified") await checkFieldRequirements(ctx, stage, client);
    await ctx.db.patch(stage._id, { status: args.decision, reviewNote: reviewNote || undefined, updatedAt: Date.now() });
    await activity(ctx, client, actor, args.decision, args.decision === "verified" ? `${stage.title} verified by the office.` : `Changes requested: ${reviewNote}`, stage._id);
    return null;
  },
});

const uploadTicketValidator = v.object({ ...schema.tables.fieldUploadTickets.validator.fields,
  _id: v.id("fieldUploadTickets"), _creationTime: v.number() });

async function validateUploadTicket(ctx: QueryCtx | MutationCtx, ticket: Doc<"fieldUploadTickets">) {
  if (ticket.expiresAt < Date.now()) throw new ConvexError("Photo upload expired. Try again.");
  const client = await ctx.db.get(ticket.clientId);
  const task = await ctx.db.get(ticket.taskId);
  const stage = task && await ctx.db.get(task.stageId);
  if (!client || !task || !stage || task.clientId !== client._id || task.kind !== "field" || task.retired || stage.archived) throw new ConvexError("Photo requirement is no longer available.");
  await requireCurrentSchedule(ctx, client);
  editableStage(stage);
  if (ticket.officeMemberId) {
    const member = await ctx.db.get(ticket.officeMemberId);
    assertWorkspace(member, client.workspaceId);
    if (member?.authUserId && member.authUserId !== ticket.authUserId) throw new ConvexError("Access removed.");
  } else if (ticket.projectLinkId) {
    if (isOfficeOnlyDrawWork(task.label)) throw new ConvexError("Photo requirement is no longer available.");
    const link = await ctx.db.get(ticket.projectLinkId);
    if (!link || link.revokedAt || link.clientId !== client._id || ticket.authUserId !== `link:${link._id}`) throw new ConvexError("Project access was removed.");
  } else throw new ConvexError("Upload is not authorized.");
  return { client, task, stage };
}

export const createPhotoUpload = mutation({
  args: { taskId: v.id("projectTasks"), filename: v.string(), token: v.optional(v.string()) }, returns: v.string(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.kind !== "field" || task.retired) throw new ConvexError("Choose a field requirement for these photos.");
    const { actor, stage, client } = await stageAccess(ctx, task.stageId, args.token);
    if (!actor.office && isOfficeOnlyDrawWork(task.label)) throw new ConvexError("Requirement is not available in the field portal.");
    await requireCurrentSchedule(ctx, client);
    if (stage.archived) throw new ConvexError("This stage is kept as earlier project history.");
    editableStage(stage);
    const files = await ctx.db.query("projectFiles").withIndex("by_clientId", q => q.eq("clientId", client._id)).take(200);
    if (files.length >= 200) throw new ConvexError("This project has reached the 200-file limit.");
    const pending = await ctx.db.query("fieldUploadTickets").withIndex("by_clientId", q => q.eq("clientId", client._id)).take(21);
    if (pending.filter(ticket => ticket.expiresAt > Date.now()).length >= 20) throw new ConvexError("Several uploads are already waiting. Finish them or try again in 10 minutes.");
    for (const ticket of pending) if (ticket.expiresAt <= Date.now()) await ctx.db.delete(ticket._id);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    await ctx.db.insert("fieldUploadTickets", { tokenHash: await hashToken(token), clientId: client._id, taskId: task._id,
      authUserId: actor.authUserId, actorName: actor.name, filename: cleanText(args.filename, "Filename", 180),
      officeMemberId: actor.office ? actor.member._id : undefined, projectLinkId: actor.office ? undefined : actor.link._id,
      expiresAt: Date.now() + 10 * 60_000 });
    return `${process.env.CONVEX_SITE_URL}/field-photo?token=${token}`;
  },
});

export const consumePhotoUpload = internalMutation({
  args: { token: v.string() }, returns: uploadTicketValidator,
  handler: async (ctx, args) => {
    if (args.token.length > 200) throw new ConvexError("Invalid upload token.");
    const tokenHash = await hashToken(args.token);
    const ticket = await ctx.db.query("fieldUploadTickets").withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!ticket) throw new ConvexError("Upload link is no longer available.");
    await validateUploadTicket(ctx, ticket);
    await ctx.db.delete(ticket._id);
    return ticket;
  },
});

export const finishPhotoUpload = internalMutation({
  args: { ticket: uploadTicketValidator, storageId: v.id("_storage"), contentType: v.union(v.literal("image/jpeg"), v.literal("image/png"), v.literal("image/webp")) }, returns: v.id("projectFiles"),
  handler: async (ctx, args) => {
    const { client, task, stage } = await validateUploadTicket(ctx, args.ticket);
    const metadata = await ctx.db.system.get(args.storageId);
    // The HTTP handler validates image bytes. Storage contentType is optional,
    // so preserve the verified type when storage metadata omits it.
    if (!metadata || metadata.size > 8 * 1024 * 1024 || (metadata.contentType && metadata.contentType !== args.contentType)) throw new ConvexError("Upload a JPEG, PNG, or WebP photo under 8 MB.");
    const files = await ctx.db.query("projectFiles").withIndex("by_clientId", q => q.eq("clientId", client._id)).take(200);
    if (files.length >= 200) throw new ConvexError("This project has reached the 200-file limit.");
    await ctx.db.insert("workspaceFiles", { workspaceId: client.workspaceId, storageId: args.storageId });
    const id = await ctx.db.insert("projectFiles", { workspaceId: client.workspaceId, clientId: client._id,
      stageId: stage._id, taskId: task._id, storageId: args.storageId, filename: args.ticket.filename,
      contentType: args.contentType, kind: "photo", uploadedBy: args.ticket.authUserId, uploadedByName: args.ticket.actorName, createdAt: Date.now() });
    await ctx.db.patch(stage._id, { status: stage.status === "not_started" ? "in_progress" : stage.status, updatedAt: Date.now() });
    await activity(ctx, client, { authUserId: args.ticket.authUserId, name: args.ticket.actorName }, "photo_added", `Added a progress photo for ${task.label}.`, stage._id);
    return id;
  },
});

export const shareDocument = mutation({
  args: { clientId: v.id("clients"), fileId: v.id("clientFiles"), confirmedNonfinancial: v.boolean() }, returns: v.id("projectFiles"),
  handler: async (ctx, args) => {
    const { client, actor } = await officeProject(ctx, args.clientId);
    if (!args.confirmedNonfinancial) throw new ConvexError("Confirm this document contains no financial information before sharing.");
    const source = await ctx.db.get(args.fileId);
    if (!source || source.clientId !== client._id || source.type !== "uploaded") throw new ConvexError("Choose an uploaded plan or specification from this client's files.");
    assertWorkspace(source, client.workspaceId);
    const metadata = await ctx.db.system.get(source.storageId);
    const extension = source.filename.split(".").pop()?.toLowerCase();
    const types: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    const contentType = metadata?.contentType || types[extension ?? ""];
    if (!metadata || metadata.size > 8 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(contentType ?? "")) throw new ConvexError("Share a PDF or image under 8 MB.");
    const files = await ctx.db.query("projectFiles").withIndex("by_clientId", q => q.eq("clientId", client._id)).take(200);
    const existing = files.find(f => f.storageId === source.storageId && f.kind === "document");
    if (existing) return existing._id;
    if (files.length >= 200) throw new ConvexError("This project has reached the 200-file limit.");
    const id = await ctx.db.insert("projectFiles", { workspaceId: client.workspaceId, clientId: client._id, storageId: source.storageId,
      filename: source.filename, contentType, kind: "document", uploadedBy: actor.authUserId, uploadedByName: actor.name, createdAt: Date.now() });
    await activity(ctx, client, actor, "document_shared", "A plan or specification was shared with the field team.");
    return id;
  },
});

export const unshareDocument = mutation({
  args: { id: v.id("projectFiles") }, returns: v.null(),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.id);
    if (!file || file.kind !== "document") throw new ConvexError("Shared document not found.");
    await officeProject(ctx, file.clientId);
    await ctx.db.delete(file._id);
    return null;
  },
});

export const fileAccess = internalQuery({
  args: { id: v.id("projectFiles"), token: v.optional(v.string()) }, returns: v.object({ storageId: v.id("_storage"), filename: v.string(), contentType: v.string() }),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.id);
    if (!file) throw new ConvexError("File is no longer available.");
    const { actor } = await projectAccess(ctx, file.clientId, args.token);
    if (!actor.office && file.taskId) {
      const task = await ctx.db.get(file.taskId);
      if (!task || task.clientId !== file.clientId || isOfficeOnlyDrawWork(task.label)) throw new ConvexError("File is no longer available.");
    }
    return { storageId: file.storageId, filename: file.filename, contentType: file.contentType };
  },
});

export const readFile = action({
  args: { id: v.id("projectFiles"), token: v.optional(v.string()) }, returns: v.object({ bytes: v.bytes(), filename: v.string(), contentType: v.string() }),
  handler: async (ctx, args): Promise<{ bytes: ArrayBuffer; filename: string; contentType: string }> => {
    const file = await ctx.runQuery(internal.field.fileAccess, args);
    const blob = await ctx.storage.get(file.storageId);
    if (!blob || blob.size > 8 * 1024 * 1024) throw new ConvexError("File is unavailable or exceeds the 8 MB limit.");
    // Authenticate every read. Permanent storage URLs would remain usable after
    // an assignment or shared document is revoked.
    return { bytes: await blob.arrayBuffer(), filename: file.filename, contentType: file.contentType };
  },
});

export const notifications = query({
  args: {}, returns: v.object({ items: v.array(v.object({ ...activityValidator.fields, clientId: v.id("clients"), projectName: v.string(), read: v.boolean() })), hasOlder: v.boolean() }),
  handler: async ctx => {
    const workspaceId = await requireAuth(ctx);
    const user = await authComponent.getAuthUser(ctx);
    const list = await ctx.db.query("projectActivity").withIndex("by_workspaceId_and_createdAt", q => q.eq("workspaceId", workspaceId)).order("desc").take(61);
    const rows = await Promise.all(list.slice(0, 60).map(async row => {
      const [client, read] = await Promise.all([ctx.db.get(row.clientId),
        ctx.db.query("projectNotificationReads").withIndex("by_authUserId_and_activityId", q => q.eq("authUserId", user._id).eq("activityId", row._id)).unique()]);
      return client ? { ...activityView(row), clientId: client._id, projectName: client.name, read: !!read || row.actorId === user._id } : null;
    }));
    return { items: rows.filter((row): row is NonNullable<typeof row> => row !== null), hasOlder: list.length > 60 };
  },
});

export const markNotificationsRead = mutation({
  args: { ids: v.array(v.id("projectActivity")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const user = await authComponent.getAuthUser(ctx);
    if (args.ids.length > 60) throw new ConvexError("Select at most 60 updates at once.");
    for (const id of new Set(args.ids)) {
      const event = await ctx.db.get(id);
      assertWorkspace(event, workspaceId);
      const read = await ctx.db.query("projectNotificationReads").withIndex("by_authUserId_and_activityId", q => q.eq("authUserId", user._id).eq("activityId", id)).unique();
      if (!read) await ctx.db.insert("projectNotificationReads", { activityId: id, authUserId: user._id });
    }
    return null;
  },
});

export const cleanupDeletedProject = internalMutation({
  args: { clientId: v.id("clients") }, returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.clientId)) throw new ConvexError("Only deleted projects can be cleaned up.");
    const clientId = args.clientId;
    const [stageRows, taskRows, invitations, assignments, links, tickets, files, events] = await Promise.all([
      ctx.db.query("projectStages").withIndex("by_clientId_and_order", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("projectTasks").withIndex("by_clientId", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("fieldInvitations").withIndex("by_clientId", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("fieldAssignments").withIndex("by_clientId", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("fieldProjectLinks").withIndex("by_clientId", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("fieldUploadTickets").withIndex("by_clientId", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("projectFiles").withIndex("by_clientId", q => q.eq("clientId", clientId)).take(25),
      ctx.db.query("projectActivity").withIndex("by_clientId_and_createdAt", q => q.eq("clientId", clientId)).take(25),
    ]);
    for (const row of [...stageRows, ...taskRows, ...invitations, ...assignments, ...links, ...tickets]) await ctx.db.delete(row._id);
    for (const file of files) {
      if (file.kind === "photo") {
        await ctx.storage.delete(file.storageId);
        const ownership = await ctx.db.query("workspaceFiles").withIndex("by_storageId", q => q.eq("storageId", file.storageId)).unique();
        if (ownership) await ctx.db.delete(ownership._id);
      }
      await ctx.db.delete(file._id);
    }
    for (const event of events) {
      const reads = await ctx.db.query("projectNotificationReads").withIndex("by_activityId", q => q.eq("activityId", event._id)).take(25);
      for (const read of reads) await ctx.db.delete(read._id);
      if (reads.length < 25) await ctx.db.delete(event._id);
    }
    if ([stageRows, taskRows, invitations, assignments, links, tickets, files, events].some(rows => rows.length)) {
      await ctx.scheduler.runAfter(0, internal.field.cleanupDeletedProject, { clientId });
    }
    return null;
  },
});
