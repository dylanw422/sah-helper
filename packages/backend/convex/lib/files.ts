import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { assertWorkspace } from "./workspaces";

export async function requireFile(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
  workspaceId?: Id<"workspaces">,
) {
  const record = await ctx.db
    .query("workspaceFiles")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
  assertWorkspace(record, workspaceId);
}

export async function storeWorkspaceFile(
  ctx: ActionCtx,
  blob: Blob,
  workspaceId?: Id<"workspaces">,
) {
  const storageId = await ctx.storage.store(blob);
  await ctx.runMutation(internal.uploads.registerGenerated, {
    storageId,
    workspaceId,
  });
  return storageId;
}
