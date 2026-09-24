import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertWorkspace } from "./lib/workspaces";
import schema from "./schema";

const itemValidator = v.object({
  description: v.string(),
  quantity: v.number(),
  unitPriceCents: v.number(),
});
const contentValidator = {
  name: v.string(),
  description: v.string(),
  items: v.array(itemValidator),
  documentIds: v.array(v.id("customDocuments")),
};
type Content = {
  name: string;
  description: string;
  items: { description: string; quantity: number; unitPriceCents: number }[];
  documentIds: Id<"customDocuments">[];
};

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function validateContent(content: Content) {
  const name = content.name.trim().replace(/\s+/g, " ");
  const description = content.description.trim();
  if (!name || name.length > 100) throw new ConvexError("Bundle name must be 1–100 characters.");
  if (description.length > 1000) throw new ConvexError("Bundle description must be at most 1,000 characters.");
  if (content.items.length < 1 || content.items.length > 100)
    throw new ConvexError("A bundle needs 1–100 line items.");
  if (content.documentIds.length > 50 || new Set(content.documentIds).size !== content.documentIds.length)
    throw new ConvexError("Choose at most 50 unique documents.");
  const items = content.items.map((item, index) => {
    const rowDescription = item.description.trim();
    if (!rowDescription || rowDescription.length > 500)
      throw new ConvexError(`Item ${index + 1} needs a description of at most 500 characters.`);
    if (normalize(rowDescription) === "profit")
      throw new ConvexError("Profit is controlled by the invoice, not a bundle item.");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 ||
        Math.abs(Math.round(item.quantity * 1000) - item.quantity * 1000) > 1e-7)
      throw new ConvexError(`Item ${index + 1} needs a positive quantity with at most three decimals.`);
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0)
      throw new ConvexError(`Item ${index + 1} needs a valid nonnegative price in cents.`);
    if (!Number.isSafeInteger(Math.round(item.quantity * item.unitPriceCents)))
      throw new ConvexError(`Item ${index + 1} exceeds the supported amount.`);
    return { ...item, description: rowDescription };
  });
  if (!Number.isSafeInteger(items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0)))
    throw new ConvexError("Bundle subtotal exceeds the supported amount.");
  return { name, normalizedName: normalize(name), description, items };
}

async function assertUniqueName(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces"> | undefined,
  normalizedName: string,
  except?: Id<"bundles">,
) {
  const existing = await ctx.db.query("bundles")
    .withIndex("by_workspace_name", q => q.eq("workspaceId", workspaceId).eq("normalizedName", normalizedName))
    .unique();
  if (existing && existing._id !== except) throw new ConvexError("A bundle with this name already exists.");
}

async function checkedDocuments(
  ctx: MutationCtx,
  ids: Id<"customDocuments">[],
) {
  return Promise.all(ids.map(async id => {
    const doc = await ctx.db.get(id);
    if (!doc || doc.category === "contract" || !(await ctx.storage.getUrl(doc.storageId)))
      throw new ConvexError("A selected document is missing or cannot be added to a bundle.");
    return doc;
  }));
}

async function writeChildren(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces"> | undefined,
  bundleId: Id<"bundles">,
  items: ReturnType<typeof validateContent>["items"],
  documents: Doc<"customDocuments">[],
) {
  for (const [order, item] of items.entries())
    await ctx.db.insert("bundleItems", { workspaceId, bundleId, ...item, order });
  for (const [order, doc] of documents.entries())
    await ctx.db.insert("bundleDocuments", {
      workspaceId, bundleId, documentId: doc._id,
      displayNameSnapshot: doc.displayName, categorySnapshot: doc.category as "waiver" | "spec-sheet" | "job-specific", order,
    });
}

async function children(ctx: QueryCtx | MutationCtx, bundleId: Id<"bundles">) {
  const [items, references] = await Promise.all([
    ctx.db.query("bundleItems").withIndex("by_bundle_order", q => q.eq("bundleId", bundleId)).collect(),
    ctx.db.query("bundleDocuments").withIndex("by_bundle_order", q => q.eq("bundleId", bundleId)).collect(),
  ]);
  return { items, references };
}

export const listBundles = query({
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 50)
      throw new ConvexError("Choose a page size from 1 to 50.");
    const search = args.search?.trim();
    if (search && search.length > 100) throw new ConvexError("Search must be at most 100 characters.");
    return search
      ? ctx.db.query("bundles")
          .withSearchIndex("search_bundles", q => q.search("searchText", search.toLocaleLowerCase()).eq("workspaceId", workspaceId))
          .paginate(args.paginationOpts)
      : ctx.db.query("bundles")
          .withIndex("by_workspace_updated", q => q.eq("workspaceId", workspaceId))
          .order("desc").paginate(args.paginationOpts);
  },
});

export const getBundle = query({
  args: { id: v.id("bundles") },
  returns: v.union(v.null(), v.object({
    ...schema.tables.bundles.validator.fields,
    _id: v.id("bundles"), _creationTime: v.number(),
    items: v.array(v.object({
      ...schema.tables.bundleItems.validator.fields,
      _id: v.id("bundleItems"), _creationTime: v.number(),
    })),
    documents: v.array(v.object({
      ...schema.tables.bundleDocuments.validator.fields,
      _id: v.id("bundleDocuments"), _creationTime: v.number(),
      available: v.boolean(), displayName: v.string(),
    })),
  })),
  handler: async (ctx, { id }) => {
    const workspaceId = await requireAuth(ctx);
    const bundle = await ctx.db.get(id);
    if (!bundle) return null;
    assertWorkspace(bundle, workspaceId);
    const { items, references } = await children(ctx, id);
    for (const child of [...items, ...references]) assertWorkspace(child, workspaceId);
    const documents = await Promise.all(references.map(async ref => {
      const document = await ctx.db.get(ref.documentId);
      const available = !!document && document.category === ref.categorySnapshot && !!(await ctx.storage.getUrl(document.storageId));
      return { ...ref, available,
        displayName: document?.displayName ?? ref.displayNameSnapshot };
    }));
    return { ...bundle, items, documents };
  },
});

export const createBundle = mutation({
  args: contentValidator,
  returns: v.id("bundles"),
  handler: async (ctx, content) => {
    const workspaceId = await requireAuth(ctx);
    const valid = validateContent(content);
    await assertUniqueName(ctx, workspaceId, valid.normalizedName);
    const documents = await checkedDocuments(ctx, content.documentIds);
    const now = Date.now();
    const id = await ctx.db.insert("bundles", {
      workspaceId, name: valid.name, normalizedName: valid.normalizedName,
      description: valid.description, searchText: `${valid.normalizedName} ${normalize(valid.description)}`,
      itemCount: valid.items.length, documentCount: documents.length,
      subtotalCents: valid.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0),
      revision: 1, createdAt: now, updatedAt: now,
    });
    await writeChildren(ctx, workspaceId, id, valid.items, documents);
    return id;
  },
});

export const updateBundle = mutation({
  args: { id: v.id("bundles"), expectedRevision: v.number(), ...contentValidator },
  returns: v.id("bundles"),
  handler: async (ctx, { id, expectedRevision, ...content }) => {
    const workspaceId = await requireAuth(ctx);
    const bundle = await ctx.db.get(id);
    assertWorkspace(bundle, workspaceId);
    if (bundle!.revision !== expectedRevision) throw new ConvexError("This bundle changed. Reload it before saving.");
    const valid = validateContent(content);
    await assertUniqueName(ctx, workspaceId, valid.normalizedName, id);
    const documents = await checkedDocuments(ctx, content.documentIds);
    const { items, references } = await children(ctx, id);
    for (const child of [...items, ...references]) {
      assertWorkspace(child, workspaceId);
      await ctx.db.delete(child._id);
    }
    await writeChildren(ctx, workspaceId, id, valid.items, documents);
    await ctx.db.patch(id, {
      name: valid.name, normalizedName: valid.normalizedName, description: valid.description,
      searchText: `${valid.normalizedName} ${normalize(valid.description)}`,
      itemCount: valid.items.length, documentCount: documents.length,
      subtotalCents: valid.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0),
      revision: expectedRevision + 1, updatedAt: Date.now(),
    });
    return id;
  },
});

export const duplicateBundle = mutation({
  args: { id: v.id("bundles"), name: v.string() },
  returns: v.id("bundles"),
  handler: async (ctx, { id, name }) => {
    const workspaceId = await requireAuth(ctx);
    const bundle = await ctx.db.get(id);
    assertWorkspace(bundle, workspaceId);
    const { items, references } = await children(ctx, id);
    for (const child of [...items, ...references]) assertWorkspace(child, workspaceId);
    const content: Content = {
      name, description: bundle!.description,
      items: items.map(item => ({ description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
      documentIds: references.map(ref => ref.documentId),
    };
    const valid = validateContent(content);
    await assertUniqueName(ctx, workspaceId, valid.normalizedName);
    const documents = await checkedDocuments(ctx, content.documentIds);
    const now = Date.now();
    const copyId = await ctx.db.insert("bundles", {
      workspaceId, name: valid.name, normalizedName: valid.normalizedName,
      description: valid.description, searchText: `${valid.normalizedName} ${normalize(valid.description)}`,
      itemCount: valid.items.length, documentCount: documents.length,
      subtotalCents: valid.items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0),
      revision: 1, createdAt: now, updatedAt: now,
    });
    await writeChildren(ctx, workspaceId, copyId, valid.items, documents);
    return copyId;
  },
});

export const deleteBundle = mutation({
  args: { id: v.id("bundles") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const workspaceId = await requireAuth(ctx);
    assertWorkspace(await ctx.db.get(id), workspaceId);
    const { items, references } = await children(ctx, id);
    for (const child of [...items, ...references]) {
      assertWorkspace(child, workspaceId);
      await ctx.db.delete(child._id);
    }
    await ctx.db.delete(id);
    return null;
  },
});
