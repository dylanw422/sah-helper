import { storeWorkspaceFile } from "./lib/files";
import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertWorkspace } from "./lib/workspaces";
import { buildInvoicePdf } from "./lib/invoicePdf";
import { lineItemValidator } from "./schema";

export const buildInvoice = action({
  args: {
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.string(),
    invoiceDate: v.string(),
    lineItems: v.array(lineItemValidator),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ storageId: Id<"_storage">; url: string }> => {
    const workspaceId = await requireAuth(ctx);

    const settings = await ctx.runQuery(api.settings.getSettings);
    if (!settings) {
      throw new Error(
        "Contractor settings are not configured. Visit Settings before building invoices.",
      );
    }

    const doc = await buildInvoicePdf({
      invoiceNumber: args.invoiceNumber,
      invoiceDate: args.invoiceDate,
      caseNumber: args.caseNumber,
      client: {
        name: args.name,
        street: args.street,
        city: args.city,
        state: args.state,
        zip: args.zip,
        phone: args.phone,
      },
      contractor: settings,
      lineItems: args.lineItems,
    });

    const bytes = await doc.save();
    const storageId = await storeWorkspaceFile(
      ctx,
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
      workspaceId,
    );
    const url = await ctx.storage.getUrl(storageId);
    if (!url)
      throw new Error("Could not create a download URL for the invoice.");
    return { storageId, url };
  },
});

export const saveInvoice = mutation({
  args: {
    id: v.optional(v.id("invoices")),
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.string(),
    invoiceDate: v.string(),
    lineItems: v.array(lineItemValidator),
    waiverIds: v.optional(v.array(v.id("customDocuments"))),
    specSheetIds: v.optional(v.array(v.id("customDocuments"))),
    jobSpecificIds: v.optional(v.array(v.id("customDocuments"))),
  },
  handler: async (ctx, { id, ...data }) => {
    const workspaceId = await requireAuth(ctx);
    const groups = [
      [data.waiverIds ?? [], "waiver"],
      [data.specSheetIds ?? [], "spec-sheet"],
      [data.jobSpecificIds ?? [], "job-specific"],
    ] as const;
    const allIds = groups.flatMap(([ids]) => ids);
    if (allIds.length > 50 || new Set(allIds).size !== allIds.length)
      throw new Error("Select at most 50 unique supporting documents.");
    for (const [ids, category] of groups) {
      for (const documentId of ids) {
        const doc = await ctx.db.get(documentId);
        if (!doc || doc.category !== category)
          throw new Error("A selected supporting document is unavailable. Remove it and try again.");
      }
    }
    const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
    const now = Date.now();
    let savedId: Id<"invoices">;
    if (id) {
      assertWorkspace(await ctx.db.get(id), workspaceId);
      await ctx.db.patch(id, { ...data, total, updatedAt: now });
      savedId = id;
    } else {
      savedId = await ctx.db.insert("invoices", {
        workspaceId,
        ...data,
        total,
        createdAt: now,
        updatedAt: now,
      });
    }
    return savedId;
  },
});

export const listInvoices = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireAuth(ctx);
    return await ctx.db
      .query("invoices")
      .withIndex("by_workspaceId_and_updatedAt", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .order("desc")
      .take(200);
  },
});

export const getInvoice = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const workspaceId = await requireAuth(ctx);
    const record = await ctx.db.get(id);
    assertWorkspace(record, workspaceId);
    return record;
  },
});

export const updateInvoiceDocuments = mutation({
  args: {
    id: v.id("invoices"),
    waiverIds: v.array(v.id("customDocuments")),
    specSheetIds: v.array(v.id("customDocuments")),
    jobSpecificIds: v.array(v.id("customDocuments")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    assertWorkspace(await ctx.db.get(args.id), workspaceId);
    const groups = [
      [args.waiverIds, "waiver"], [args.specSheetIds, "spec-sheet"], [args.jobSpecificIds, "job-specific"],
    ] as const;
    const ids = groups.flatMap(([group]) => group);
    if (ids.length > 50 || new Set(ids).size !== ids.length)
      throw new Error("Select at most 50 unique supporting documents.");
    for (const [group, category] of groups) for (const id of group) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.category !== category) throw new Error("A selected supporting document is unavailable.");
    }
    await ctx.db.patch(args.id, {
      waiverIds: args.waiverIds, specSheetIds: args.specSheetIds,
      jobSpecificIds: args.jobSpecificIds, updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteInvoice = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const workspaceId = await requireAuth(ctx);
    assertWorkspace(await ctx.db.get(id), workspaceId);
    await ctx.db.delete(id);
  },
});

export const suggestInvoiceNumber = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireAuth(ctx);
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    // Saved invoices and packet-generated clients both consume numbers, so
    // suggest one past the max suffix seen in either table.
    const [clients, invoices] = await Promise.all([
      ctx.db
        .query("clients")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
        .take(1000),
      ctx.db
        .query("invoices")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
        .take(1000),
    ]);
    const numbers = [
      ...clients.map((c) => c.invoiceNumber),
      ...invoices.map((i) => i.invoiceNumber),
    ];
    let maxSeq = 0;
    for (const number of numbers) {
      if (!number.startsWith(prefix)) continue;
      const seq = parseInt(number.slice(prefix.length), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
    return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
  },
});
