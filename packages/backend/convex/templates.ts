import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { enumerateFields } from "./lib/pdf";
import { TEMPLATE_KEYS } from "./lib/templateKeys";
import { createUploadUrl } from "./uploads";
import { requireFile } from "./lib/files";
import schema from "./schema";
import type { QueryCtx } from "./_generated/server";

async function availableTemplates(
  ctx: QueryCtx,
  workspaceId?: Id<"workspaces">,
) {
  const base = await ctx.db
    .query("pdfTemplates")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", undefined))
    .take(100);
  if (!workspaceId) return base;
  const own = await ctx.db
    .query("pdfTemplates")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .take(100);
  const overrides = new Map(own.map((t) => [t.key, t]));
  return [...base.filter((t) => !overrides.has(t.key)), ...own];
}

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireAuth(ctx);
    const templates = await availableTemplates(ctx, workspaceId);
    return TEMPLATE_KEYS.map((key) => {
      const template = templates.find((t) => t.key === key);
      return {
        key,
        id: template?._id ?? null,
        uploaded: !!template,
        uploadedAt: template?.uploadedAt ?? null,
        storageId: template?.storageId ?? null,
        fieldMap: template?.fieldMap ?? null,
      };
    });
  },
});

export const getTemplateUrl = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const template = (await availableTemplates(ctx, workspaceId)).find(
      (t) => t.key === args.key,
    );
    if (!template) return null;
    return await ctx.storage.getUrl(template.storageId);
  },
});

export const generateTemplateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await createUploadUrl(ctx);
  },
});

export const inspectTemplate = action({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<{ name: string; type: string }[]> => {
    await requireAuth(ctx);
    const templates: { key: string; storageId: Id<"_storage"> | null }[] =
      await ctx.runQuery(api.templates.listTemplates);
    const template = templates.find((t) => t.key === args.key);
    if (!template?.storageId) {
      throw new Error(`Template not uploaded: ${args.key}`);
    }
    const blob = await ctx.storage.get(template.storageId);
    if (!blob)
      throw new Error(`Template file missing from storage: ${args.key}`);
    return await enumerateFields(await blob.arrayBuffer());
  },
});

export const listTemplatesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("pdfTemplates").take(100);
  },
});

export const inspectAllTemplates = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<Record<string, { name: string; type: string }[]>> => {
    const templates: { key: string; storageId: Id<"_storage"> }[] =
      await ctx.runQuery(internal.templates.listTemplatesInternal);
    const result: Record<string, { name: string; type: string }[]> = {};
    for (const template of templates) {
      const blob = await ctx.storage.get(template.storageId);
      if (!blob) continue;
      result[template.key] = await enumerateFields(await blob.arrayBuffer());
    }
    return result;
  },
});

export const registerTemplate = mutation({
  args: {
    key: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    await requireFile(ctx, args.storageId, workspaceId);
    if (!(TEMPLATE_KEYS as readonly string[]).includes(args.key)) {
      throw new Error(`Unknown template key: ${args.key}`);
    }
    const existing = await ctx.db
      .query("pdfTemplates")
      .withIndex("by_workspaceId_and_key", (q) =>
        q.eq("workspaceId", workspaceId).eq("key", args.key),
      )
      .unique();
    let templateId;
    if (existing) {
      // Keep earlier base versions available to packets already in flight.
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        uploadedAt: Date.now(),
        fieldMap: undefined,
      });
      templateId = existing._id;
    } else {
      templateId = await ctx.db.insert("pdfTemplates", {
        workspaceId,
        key: args.key,
        storageId: args.storageId,
        uploadedAt: Date.now(),
      });
    }
    // Regenerate the AI field mapping for the new file
    await ctx.scheduler.runAfter(
      0,
      internal.templateMapping.mapTemplateFields,
      {
        templateId,
      },
    );
    return templateId;
  },
});

export const getTemplateInternal = internalQuery({
  args: { templateId: v.id("pdfTemplates") },
  returns: v.union(v.null(), v.object({
    ...schema.tables.pdfTemplates.validator.fields,
    _id: v.id("pdfTemplates"), _creationTime: v.number(),
  })),
  handler: async (ctx, args) => ctx.db.get(args.templateId),
});

export const saveFieldMap = internalMutation({
  args: {
    templateId: v.id("pdfTemplates"),
    fieldMap: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, { fieldMap: args.fieldMap });
  },
});
