import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

export async function currentMembership(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  const member = await ctx.db
    .query("authorizedUsers")
    .withIndex("by_email", (q) => q.eq("email", user.email.toLowerCase()))
    .unique();
  if (member?.identity && member.identity !== identity.tokenIdentifier)
    return null;
  if (member?.authUserId && member.authUserId !== user._id) return null;
  return member;
}

export async function requireMembership(ctx: QueryCtx | MutationCtx) {
  const member = await currentMembership(ctx);
  if (!member) throw new ConvexError("Create a workspace to continue.");
  return member;
}

// Records predating workspaces belong exclusively to the existing company.
export function assertWorkspace(
  record: { workspaceId?: Id<"workspaces"> } | null,
  workspaceId: Id<"workspaces"> | undefined,
) {
  if (!record || record.workspaceId !== workspaceId) {
    throw new ConvexError("Record not found in your workspace.");
  }
}

export function assertAdmin(member: Doc<"authorizedUsers">) {
  // Existing staff retain their existing administrative permissions.
  if (member.role === "member")
    throw new ConvexError(
      "Only workspace administrators can manage team access.",
    );
}
