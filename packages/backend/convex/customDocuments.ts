import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { enumerateFields } from "./lib/pdf";

const categoryValidator = v.union(
  v.literal("contract"),
  v.literal("waiver"),
  v.literal("spec-sheet"),
  v.literal("job-specific"),
);

export const listCustomDocuments = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const docs = args.category
      ? await ctx.db
          .query("customDocuments")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .take(100)
      : await ctx.db.query("customDocuments").take(100);
    return docs.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

export const registerCustomDocument = mutation({
  args: {
    category: categoryValidator,
    displayName: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const id = await ctx.db.insert("customDocuments", {
      category: args.category,
      displayName: args.displayName,
      storageId: args.storageId,
      uploadedAt: Date.now(),
    });
    if (args.category === "contract") {
      await ctx.scheduler.runAfter(0, internal.templateMapping.mapCustomDocumentFields, { id });
    }
    return id;
  },
});

export const deleteCustomDocument = mutation({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc) return;
    await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(args.id);
  },
});

export const getCustomDocumentUrl = query({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc) return null;
    return await ctx.storage.getUrl(doc.storageId);
  },
});

export const inspectCustomDocument = action({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args): Promise<{ name: string; type: string }[]> => {
    await requireAuth(ctx);
    const doc: Doc<"customDocuments"> | null = await ctx.runQuery(
      internal.customDocuments.getCustomDocumentInternal,
      { id: args.id },
    );
    if (!doc) throw new Error("Document not found.");
    const blob = await ctx.storage.get(doc.storageId);
    if (!blob) throw new Error(`Document file missing from storage: ${doc.displayName}`);
    return await enumerateFields(await blob.arrayBuffer());
  },
});

export const getCustomDocumentInternal = internalQuery({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listCustomDocumentsInternal = internalQuery({
  args: { category: categoryValidator },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("customDocuments")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .take(100);
    return docs.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

export const saveCustomFieldMap = internalMutation({
  args: {
    id: v.id("customDocuments"),
    fieldMap: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { fieldMap: args.fieldMap });
  },
});
