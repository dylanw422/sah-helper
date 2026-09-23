import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireFile } from "./lib/files";

export async function createUploadUrl(ctx: MutationCtx) {
  const workspaceId = await requireAuth(ctx);
  const token = crypto.randomUUID();
  await ctx.db.insert("uploadTickets", {
    workspaceId,
    token,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return `${process.env.CONVEX_SITE_URL}/workspace-upload?token=${token}`;
}

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await createUploadUrl(ctx);
  },
});

export const checkFile = internalQuery({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireFile(ctx, args.storageId, await requireAuth(ctx));
    return null;
  },
});

export const consumeTicket = internalMutation({
  args: { token: v.string() },
  returns: v.object({ workspaceId: v.optional(v.id("workspaces")) }),
  handler: async (ctx, args) => {
    const ticket = await ctx.db
      .query("uploadTickets")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!ticket || ticket.expiresAt < Date.now())
      throw new ConvexError("Upload link expired. Please try again.");
    await ctx.db.delete(ticket._id);
    return { workspaceId: ticket.workspaceId };
  },
});

export const registerGenerated = internalMutation({
  args: {
    storageId: v.id("_storage"),
    workspaceId: v.optional(v.id("workspaces")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) throw new ConvexError("File is already registered.");
    await ctx.db.insert("workspaceFiles", args);
    return null;
  },
});
