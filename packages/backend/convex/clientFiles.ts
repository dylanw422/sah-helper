import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const listClientFiles = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const files = await ctx.db
      .query("clientFiles")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .take(200);
    return files.sort((a, b) => a.order - b.order);
  },
});

export const getFileDownloadUrl = query({
  args: { fileId: v.id("clientFiles") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const file = await ctx.db.get(args.fileId);
    if (!file) return null;
    return await ctx.storage.getUrl(file.storageId);
  },
});

export const addClientFile = mutation({
  args: {
    clientId: v.id("clients"),
    storageId: v.id("_storage"),
    filename: v.string(),
    type: v.union(v.literal("generated"), v.literal("uploaded")),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Client not found");

    let order = args.order;
    if (order === undefined) {
      // Uploads are appended after all existing files
      const existing = await ctx.db
        .query("clientFiles")
        .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
        .take(200);
      order = existing.reduce((max, f) => Math.max(max, f.order), -1) + 1;
    }

    const fileId = await ctx.db.insert("clientFiles", {
      clientId: args.clientId,
      storageId: args.storageId,
      filename: args.filename,
      type: args.type,
      order,
      addedAt: Date.now(),
    });

    if (args.type === "uploaded") {
      await ctx.db.patch(args.clientId, { packetDirty: true, updatedAt: Date.now() });
    }
    return fileId;
  },
});

export const deleteClientFile = mutation({
  args: { fileId: v.id("clientFiles") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const file = await ctx.db.get(args.fileId);
    if (!file) return;
    if (file.type !== "uploaded") {
      throw new Error("Only uploaded files can be deleted");
    }
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(args.fileId);
    await ctx.db.patch(file.clientId, { packetDirty: true, updatedAt: Date.now() });
  },
});
