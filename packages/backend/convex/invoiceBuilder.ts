import { v } from "convex/values";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, query } from "./_generated/server";
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

export const suggestInvoiceNumber = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const clients = await ctx.db.query("clients").take(1000);
    const seq = clients.filter((c) => c.invoiceNumber.startsWith(prefix)).length + 1;
    return `${prefix}${String(seq).padStart(3, "0")}`;
  },
});
