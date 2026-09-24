import { requireFile } from "./lib/files";
import { ConvexError, v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertWorkspace } from "./lib/workspaces";
import { lineItemValidator } from "./schema";

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function matchingPacketClient(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces"> | undefined,
  input: { name: string; street: string; caseNumber: string },
): Promise<Doc<"clients"> | null> {
  const caseNumber = normalized(input.caseNumber);
  const name = normalized(input.name);
  const street = normalized(input.street);
  let addressMatch: Doc<"clients"> | null = null;
  for await (const client of ctx.db.query("clients").withIndex("by_workspaceId", (q) =>
    q.eq("workspaceId", workspaceId),
  )) {
    if (caseNumber && normalized(client.caseNumber ?? "") === caseNumber) return client;
    if (name && street && normalized(client.name) === name && normalized(client.street) === street) {
      addressMatch = client;
    }
  }
  return addressMatch;
}

export const findExistingForPacket = query({
  args: { name: v.string(), street: v.string(), caseNumber: v.string() },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const client = await matchingPacketClient(ctx, workspaceId, args);
    return client ? { id: client._id, name: client.name } : null;
  },
});

export const saveGeneratedPacket = internalMutation({
  args: {
    replaceClientId: v.optional(v.id("clients")),
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.string(),
    drawCount: v.union(v.literal(4), v.literal(5), v.literal(6)),
    lineItems: v.array(lineItemValidator),
    subtotal: v.number(),
    total: v.number(),
    packetStorageId: v.id("_storage"),
    files: v.array(v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
    })),
  },
  handler: async (ctx, { replaceClientId, files, ...data }) => {
    const workspaceId = await requireAuth(ctx);
    await requireFile(ctx, data.packetStorageId, workspaceId);
    for (const file of files) await requireFile(ctx, file.storageId, workspaceId);

    const existing = await matchingPacketClient(ctx, workspaceId, data);
    if ((existing?._id ?? null) !== (replaceClientId ?? null)) {
      throw new ConvexError("The existing client changed. Review and confirm the replacement again.");
    }

    const now = Date.now();
    let clientId: Id<"clients">;
    if (existing) {
      const oldFiles = await ctx.db.query("clientFiles")
        .withIndex("by_workspaceId_and_clientId", (q) =>
          q.eq("workspaceId", workspaceId).eq("clientId", existing._id),
        ).take(201);
      if (oldFiles.length > 200) throw new ConvexError("Too many files to replace in one packet.");
      const reusedIds = new Set(files.map((file) => file.storageId));
      const retiredIds = new Set<Id<"_storage">>();
      for (const file of oldFiles) {
        if (!reusedIds.has(file.storageId) && file.storageId !== data.packetStorageId) {
          retiredIds.add(file.storageId);
        }
        await ctx.db.delete(file._id);
      }
      if (existing.packetStorageId && existing.packetStorageId !== data.packetStorageId &&
          !reusedIds.has(existing.packetStorageId)) {
        retiredIds.add(existing.packetStorageId);
      }
      for (const storageId of retiredIds) {
        await ctx.storage.delete(storageId);
        const ownership = await ctx.db.query("workspaceFiles")
          .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
          .unique();
        if (ownership) await ctx.db.delete(ownership._id);
      }
      await ctx.db.patch(existing._id, {
        ...data,
        status: "unsigned",
        packetDirty: false,
        updatedAt: now,
      });
      clientId = existing._id;
    } else {
      clientId = await ctx.db.insert("clients", {
        workspaceId,
        ...data,
        status: "unsigned",
        packetDirty: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let order = 0; order < files.length; order++) {
      await ctx.db.insert("clientFiles", {
        workspaceId,
        clientId,
        ...files[order],
        type: "generated",
        order,
        addedAt: now,
      });
    }
    return clientId;
  },
});

export const listClients = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireAuth(ctx);
    return await ctx.db
      .query("clients")
      .withIndex("by_workspaceId_and_createdAt", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .order("desc")
      .take(1000);
  },
});

export const getClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const record = await ctx.db.get(args.clientId);
    assertWorkspace(record, workspaceId);
    return record;
  },
});

export const getPacketDownloadUrl = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const client = await ctx.db.get(args.clientId);
    assertWorkspace(client, workspaceId);
    if (!client?.packetStorageId) return null;
    return await ctx.storage.getUrl(client.packetStorageId);
  },
});

export const updateClientStatus = mutation({
  args: {
    clientId: v.id("clients"),
    status: v.union(
      v.literal("unsigned"),
      v.literal("signed"),
      v.literal("complete"),
    ),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    assertWorkspace(await ctx.db.get(args.clientId), workspaceId);
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
    const workspaceId = await requireAuth(ctx);
    await requireFile(ctx, args.packetStorageId, workspaceId);
    const client = await ctx.db.get(args.clientId);
    assertWorkspace(client, workspaceId);
    if (!client) throw new Error("Client not found");
    if (
      client.packetStorageId &&
      client.packetStorageId !== args.packetStorageId
    ) {
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
    const workspaceId = await requireAuth(ctx);
    const client = await ctx.db.get(args.clientId);
    assertWorkspace(client, workspaceId);
    if (!client) return;
    if (client.packetStorageId) {
      await ctx.storage.delete(client.packetStorageId);
    }
    const files = await ctx.db
      .query("clientFiles")
      .withIndex("by_workspaceId_and_clientId", (q) =>
        q.eq("workspaceId", workspaceId).eq("clientId", args.clientId),
      )
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
    const workspaceId = await requireAuth(ctx);
    await requireFile(ctx, args.packetStorageId, workspaceId);
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      workspaceId,
      ...args,
      status: "unsigned",
      createdAt: now,
      updatedAt: now,
    });
    return clientId;
  },
});
