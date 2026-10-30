import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { buildDrawWorkSchedule, drawItemKey, drawWorkKey, drawWorkTitle, fieldDrawWorkSchedule, type DrawWorkStage } from "./drawWorkSchedule";

export async function projectStages(ctx: QueryCtx | MutationCtx, client: Doc<"clients">) {
  return ctx.db.query("projectStages").withIndex("by_clientId_and_order", q => q.eq("clientId", client._id)).take(20);
}

export function projectSchedule(client: Doc<"clients">): DrawWorkStage[] {
  try {
    const schedule = client.drawWorkSchedule ?? buildDrawWorkSchedule(client.lineItems, client.drawCount);
    if (schedule.length !== client.drawCount || schedule.some((draw, index) => draw.drawNumber !== index + 1 || (index === client.drawCount - 1 ? draw.items.length !== 0 : draw.items.length === 0))) throw new Error("Incomplete schedule");
    return fieldDrawWorkSchedule(schedule);
  }
  catch { throw new ConvexError("This project's draw schedule is unavailable. Ask the office to regenerate the packet."); }
}

export function scheduleNeedsSync(client: Doc<"clients">, rows: Doc<"projectStages">[], schedule = projectSchedule(client)) {
  const active = rows.filter(row => !row.archived);
  return active.length !== schedule.length || schedule.some((draw, index) => {
    const stage = active[index];
    return !stage || stage.drawNumber !== draw.drawNumber || stage.title !== drawWorkTitle(draw, client.drawCount) || stage.scheduleKey !== drawWorkKey(draw, client.drawCount);
  });
}

export async function requireCurrentSchedule(ctx: QueryCtx | MutationCtx, client: Doc<"clients">) {
  if (scheduleNeedsSync(client, await projectStages(ctx, client))) throw new ConvexError("The draw schedule has changed. Reload this project to sync its completion stages.");
}

// A deterministic reconciliation, never an editable copy of the schedule.
// Keep task IDs, checks and photo associations for unchanged work, even when
// that work moves to a different draw. Old work stays as read-only history.
export async function synchronizeDrawStages(ctx: MutationCtx, client: Doc<"clients">) {
  const schedule = projectSchedule(client);
  const existing = await projectStages(ctx, client);
  if (!scheduleNeedsSync(client, existing, schedule)) return false;
  const allTasks = await ctx.db.query("projectTasks").withIndex("by_clientId", q => q.eq("clientId", client._id)).take(1201);
  if (allTasks.length > 1200) throw new ConvexError("This project needs office assistance before its schedule can be synced.");
  const chosen = new Set<string>();
  const retained = new Set<string>();
  const now = Date.now();
  for (const [index, draw] of schedule.entries()) {
    const match = existing.find(row => !chosen.has(row._id) && row.drawNumber === draw.drawNumber)
      ?? existing.find(row => !chosen.has(row._id) && row.drawNumber === undefined && row.order === index);
    const changed = match?.scheduleKey !== drawWorkKey(draw, client.drawCount);
    const reopened = (changed || draw.drawNumber === client.drawCount) && (match?.status === "submitted" || match?.status === "verified");
    const stageId = match?._id ?? await ctx.db.insert("projectStages", { workspaceId: client.workspaceId, clientId: client._id,
      title: drawWorkTitle(draw, client.drawCount), instructions: "", order: index, status: "not_started", updatedAt: now });
    chosen.add(stageId);
    await ctx.db.patch(stageId, { title: drawWorkTitle(draw, client.drawCount), order: index, drawNumber: draw.drawNumber,
      scheduleKey: drawWorkKey(draw, client.drawCount), archived: false, updatedAt: now,
      ...(reopened ? { status: "changes_requested" as const, reviewNote: "The draw schedule was updated. Review the current work requirements before resubmitting." } : {}) });
    for (const [order, item] of draw.items.entries()) {
      const scheduleItemKey = drawItemKey(item);
      const task = allTasks.find(row => row.scheduleItemKey === scheduleItemKey && !retained.has(row._id));
      if (task) {
        retained.add(task._id);
        await ctx.db.patch(task._id, { stageId, label: item.description, kind: "field", requiresPhoto: true, order, retired: false, updatedAt: now });
        if (task.stageId !== stageId) {
          const photos = await ctx.db.query("projectFiles").withIndex("by_taskId", q => q.eq("taskId", task._id)).take(200);
          for (const photo of photos) await ctx.db.patch(photo._id, { stageId });
        }
      } else await ctx.db.insert("projectTasks", { clientId: client._id, stageId, label: item.description, kind: "field", requiresPhoto: true,
        order, scheduleItemKey, completed: false, updatedAt: now });
    }
    const officeTasks = allTasks.filter(task => task.stageId === stageId && task.kind === "office");
    if (!officeTasks.length) {
      for (const [offset, label] of ["Inspection requirements satisfied", "Required completion paperwork received"].entries()) {
        await ctx.db.insert("projectTasks", { clientId: client._id, stageId, label, kind: "office", requiresPhoto: false,
          order: draw.items.length + offset, completed: false, updatedAt: now });
      }
    }
  }
  for (const stage of existing) if (!chosen.has(stage._id)) await ctx.db.patch(stage._id, { archived: true });
  for (const task of allTasks) if (task.kind === "field" && !retained.has(task._id)) await ctx.db.patch(task._id, { retired: true });
  await ctx.db.insert("projectActivity", { workspaceId: client.workspaceId, clientId: client._id,
    actorId: "system:draw-schedule", actorName: "Draw schedule", type: "schedule_synced",
    message: "Completion stages synced with the draw schedule. Photos and history were preserved; changed stages require review again.", createdAt: now });
  return true;
}
