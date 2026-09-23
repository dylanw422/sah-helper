import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireMembership } from "./workspaces";

export async function requireAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<Id<"workspaces"> | undefined> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  const member =
    "db" in ctx
      ? await requireMembership(ctx)
      : await ctx.runQuery(internal.workspaces.requireCurrent, {});
  return member.workspaceId as Id<"workspaces"> | undefined;
}
