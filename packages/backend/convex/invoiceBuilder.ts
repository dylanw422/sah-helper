import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
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
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage">; url: string }> => {
    await requireAuth(ctx);

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
    const storageId = await ctx.storage.store(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    );
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Could not create a download URL for the invoice.");
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
  },
  handler: async (ctx, { id, ...data }) => {
    await requireAuth(ctx);
    const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
    const now = Date.now();
    if (id) {
      await ctx.db.patch(id, { ...data, total, updatedAt: now });
      return id;
    }
    return await ctx.db.insert("invoices", { ...data, total, createdAt: now, updatedAt: now });
  },
});

export const listInvoices = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db.query("invoices").withIndex("by_updatedAt").order("desc").take(200);
  },
});

export const getInvoice = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    await requireAuth(ctx);
    return await ctx.db.get(id);
  },
});

export const deleteInvoice = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    await requireAuth(ctx);
    await ctx.db.delete(id);
  },
});

export const suggestInvoiceNumber = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    // Saved invoices and packet-generated clients both consume numbers, so
    // suggest one past the max suffix seen in either table.
    const [clients, invoices] = await Promise.all([
      ctx.db.query("clients").take(1000),
      ctx.db.query("invoices").take(1000),
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
