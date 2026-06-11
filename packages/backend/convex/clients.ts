import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { lineItemValidator } from "./schema";

export const listClients = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db.query("clients").withIndex("by_createdAt").order("desc").take(1000);
  },
});

export const getClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return await ctx.db.get(args.clientId);
  },
});

export const getPacketDownloadUrl = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client?.packetStorageId) return null;
    return await ctx.storage.getUrl(client.packetStorageId);
  },
});

export const updateClientStatus = mutation({
  args: {
    clientId: v.id("clients"),
    status: v.union(v.literal("unsigned"), v.literal("signed"), v.literal("complete")),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    await ctx.db.patch(args.clientId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const setPacketStorageId = mutation({
  args: {
    clientId: v.id("clients"),
    packetStorageId: v.id("_storage"),
    dirty: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Client not found");
    if (client.packetStorageId && client.packetStorageId !== args.packetStorageId) {
      await ctx.storage.delete(client.packetStorageId);
    }
    await ctx.db.patch(args.clientId, {
      packetStorageId: args.packetStorageId,
      packetDirty: args.dirty,
      updatedAt: Date.now(),
    });
  },
});

export const deleteClient = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client) return;
    if (client.packetStorageId) {
      await ctx.storage.delete(client.packetStorageId);
    }
    const files = await ctx.db
      .query("clientFiles")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .take(200);
    for (const file of files) {
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
    }
    await ctx.db.delete(args.clientId);
  },
});

export const createClient = mutation({
  args: {
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.optional(v.string()),
    drawCount: v.union(v.literal(4), v.literal(5), v.literal(6)),
    lineItems: v.array(lineItemValidator),
    subtotal: v.number(),
    total: v.number(),
    packetStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const now = Date.now();
    return await ctx.db.insert("clients", {
      ...args,
      status: "unsigned",
      createdAt: now,
      updatedAt: now,
    });
  },
});
