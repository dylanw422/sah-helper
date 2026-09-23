import { requireFile } from "./lib/files";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertWorkspace } from "./lib/workspaces";
import { enumerateFields } from "./lib/pdf";
import schema from "./schema";

const categoryValidator = v.union(
  v.literal("contract"),
  v.literal("waiver"),
  v.literal("spec-sheet"),
  v.literal("job-specific"),
);

const sharedCategories = ["waiver", "spec-sheet", "job-specific"] as const;

function assertDocumentReadable(
  doc: Doc<"customDocuments"> | null,
  workspaceId?: Id<"workspaces">,
) {
  if (!doc || doc.category === "contract") assertWorkspace(doc, workspaceId);
}

async function listVisibleDocuments(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces"> | undefined,
  category?: Doc<"customDocuments">["category"],
) {
  const categories = category ? [category] : ["contract" as const, ...sharedCategories];
  const groups = await Promise.all(categories.map(category =>
    category === "contract"
      ? ctx.db.query("customDocuments")
          .withIndex("by_workspaceId_and_category", q =>
            q.eq("workspaceId", workspaceId).eq("category", category))
          .take(100)
      : ctx.db.query("customDocuments")
          .withIndex("by_category", q => q.eq("category", category))
          .take(100),
  ));
  return groups.flat().sort((a, b) => a.uploadedAt - b.uploadedAt);
}

export const listCustomDocuments = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    return await listVisibleDocuments(ctx, workspaceId, args.category);
  },
});

export const registerCustomDocument = mutation({
  args: {
    category: categoryValidator,
    displayName: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    await requireFile(ctx, args.storageId, workspaceId);
    const id = await ctx.db.insert("customDocuments", {
      workspaceId,
      category: args.category,
      displayName: args.displayName,
      storageId: args.storageId,
      uploadedAt: Date.now(),
    });
    if (args.category === "contract") {
      await ctx.scheduler.runAfter(
        0,
        internal.templateMapping.mapCustomDocumentFields,
        { id },
      );
    }
    return id;
  },
});

export const deleteCustomDocument = mutation({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    assertWorkspace(doc, workspaceId);
    if (!doc) return;
    await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(args.id);
  },
});

export const getCustomDocumentUrl = query({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    assertDocumentReadable(doc, workspaceId);
    if (!doc) return null;
    return await ctx.storage.getUrl(doc.storageId);
  },
});

export const inspectCustomDocument = action({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args): Promise<{ name: string; type: string }[]> => {
    await requireAuth(ctx);
    const doc: Doc<"customDocuments"> | null = await ctx.runQuery(
      api.customDocuments.getCustomDocument,
      { id: args.id },
    );
    if (!doc) throw new Error("Document not found.");
    const blob = await ctx.storage.get(doc.storageId);
    if (!blob)
      throw new Error(`Document file missing from storage: ${doc.displayName}`);
    return await enumerateFields(await blob.arrayBuffer());
  },
});

export const getCustomDocumentInternal = internalQuery({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getCustomDocument = query({
  args: { id: v.id("customDocuments") },
  returns: v.union(v.null(), v.object({
    ...schema.tables.customDocuments.validator.fields,
    _id: v.id("customDocuments"), _creationTime: v.number(),
  })),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const doc = await ctx.db.get(args.id);
    assertDocumentReadable(doc, workspaceId);
    return doc;
  },
});

export const listCustomDocumentsInternal = internalQuery({
  args: { category: categoryValidator },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    return await listVisibleDocuments(ctx, workspaceId, args.category);
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
