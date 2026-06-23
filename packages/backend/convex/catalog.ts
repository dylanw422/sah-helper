import { v } from "convex/values";

import { api } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAuth } from "./lib/auth";

function toMatchKey(description: string): string {
  return description
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ImportPreview = {
  storageId: string;
  fileName: string;
  lineItems: { description: string; qty: number; unitPrice: number; amount: number }[];
  total: number;
  totalMismatchWarning: boolean;
};

// Idempotent: deletes prior observations for this source, then re-inserts from
// current line items and recomputes stats for every affected catalogItem.
export async function syncSource(
  ctx: MutationCtx,
  args: {
    sourceType: "invoice" | "client" | "import";
    sourceId: string;
    observedAt: number;
    lineItems: { description: string; qty: number; unitPrice: number }[];
  },
): Promise<void> {
  const items = args.lineItems.filter(
    (item) =>
      item.description.trim() !== "" &&
      item.description.trim().toLowerCase() !== "profit",
  );

  const priorObs = await ctx.db
    .query("priceObservations")
    .withIndex("by_sourceType_sourceId", (q) =>
      q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
    )
    .take(500);

  const touchedItemIds = new Set<Id<"catalogItems">>();
  for (const obs of priorObs) {
    touchedItemIds.add(obs.catalogItemId);
    await ctx.db.delete(obs._id);
  }

  const now = Date.now();
  for (const item of items) {
    const matchKey = toMatchKey(item.description);
    if (!matchKey) continue;

    let catalogItemId: Id<"catalogItems">;
    const existing = await ctx.db
      .query("catalogItems")
      .withIndex("by_matchKey", (q) => q.eq("matchKey", matchKey))
      .unique();

    if (existing) {
      catalogItemId = existing._id;
    } else {
      catalogItemId = await ctx.db.insert("catalogItems", {
        canonicalDescription: item.description.trim(),
        matchKey,
        lastUnitPrice: item.unitPrice,
        avgUnitPrice: item.unitPrice,
        minUnitPrice: item.unitPrice,
        maxUnitPrice: item.unitPrice,
        occurrences: 0,
        lastUsedAt: args.observedAt,
        createdAt: now,
        updatedAt: now,
      });
    }
    touchedItemIds.add(catalogItemId);

    await ctx.db.insert("priceObservations", {
      catalogItemId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      description: item.description,
      qty: item.qty,
      unitPrice: item.unitPrice,
      observedAt: args.observedAt,
    });
  }

  for (const catalogItemId of touchedItemIds) {
    const obs = await ctx.db
      .query("priceObservations")
      .withIndex("by_catalogItemId", (q) => q.eq("catalogItemId", catalogItemId))
      .take(1000);

    if (obs.length === 0) {
      const item = await ctx.db.get(catalogItemId);
      if (!item?.priceLocked) {
        await ctx.db.delete(catalogItemId);
      }
      continue;
    }

    const prices = obs.map((o) => o.unitPrice);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const newest = obs.reduce((a, b) => (a.observedAt > b.observedAt ? a : b));

    await ctx.db.patch(catalogItemId, {
      lastUnitPrice: newest.unitPrice,
      avgUnitPrice: avg,
      minUnitPrice: min,
      maxUnitPrice: max,
      occurrences: obs.length,
      lastUsedAt: newest.observedAt,
      updatedAt: now,
    });
  }
}

async function doBackfill(ctx: MutationCtx): Promise<void> {
  const observations = await ctx.db.query("priceObservations").take(500);
  for (const o of observations) await ctx.db.delete(o._id);

  const items = await ctx.db.query("catalogItems").take(500);
  for (const item of items) {
    if (!item.priceLocked) await ctx.db.delete(item._id);
  }

  const invoices = await ctx.db.query("invoices").take(200);
  for (const invoice of invoices) {
    const observedAt = Date.parse(`${invoice.invoiceDate}T00:00:00`) || invoice.createdAt;
    await syncSource(ctx, {
      sourceType: "invoice",
      sourceId: invoice._id,
      observedAt,
      lineItems: invoice.lineItems,
    });
  }

  const clients = await ctx.db.query("clients").take(200);
  for (const client of clients) {
    await syncSource(ctx, {
      sourceType: "client",
      sourceId: client._id,
      observedAt: client.createdAt,
      lineItems: client.lineItems,
    });
  }
}

export const listItems = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db
      .query("catalogItems")
      .withIndex("by_lastUsedAt")
      .order("desc")
      .take(1000);
  },
});

export const listItemsForGeneration = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    {
      _id: string;
      canonicalDescription: string;
      unit: string | undefined;
      representativePrice: number;
      occurrences: number;
    }[]
  > => {
    const items = await ctx.db
      .query("catalogItems")
      .withIndex("by_lastUsedAt")
      .order("desc")
      .take(300);
    return items.map((item) => ({
      _id: item._id,
      canonicalDescription: item.canonicalDescription,
      unit: item.unit,
      representativePrice:
        item.priceLocked && item.manualUnitPrice != null
          ? item.manualUnitPrice
          : item.lastUnitPrice,
      occurrences: item.occurrences,
    }));
  },
});

export const updateItem = mutation({
  args: {
    id: v.id("catalogItems"),
    canonicalDescription: v.string(),
    unit: v.string(),
    manualUnitPrice: v.union(v.number(), v.null()),
    priceLocked: v.boolean(),
  },
  handler: async (ctx, { id, canonicalDescription, unit, manualUnitPrice, priceLocked }) => {
    await requireAuth(ctx);
    await ctx.db.patch(id, {
      canonicalDescription,
      unit: unit.trim() || undefined,
      manualUnitPrice: manualUnitPrice ?? undefined,
      priceLocked: priceLocked || undefined,
      updatedAt: Date.now(),
    });
  },
});

export const deleteItem = mutation({
  args: { id: v.id("catalogItems") },
  handler: async (ctx, { id }) => {
    await requireAuth(ctx);
    const obs = await ctx.db
      .query("priceObservations")
      .withIndex("by_catalogItemId", (q) => q.eq("catalogItemId", id))
      .take(1000);
    for (const o of obs) await ctx.db.delete(o._id);
    await ctx.db.delete(id);
  },
});

// Callable from the Convex dashboard.
export const backfillFromExisting = internalMutation({
  args: {},
  handler: async (ctx) => {
    await doBackfill(ctx);
  },
});

// Callable from the Settings UI "Rebuild catalog" button.
export const triggerBackfill = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    await doBackfill(ctx);
  },
});

const PROFIT_RE = /^profit$/i;

// Extracts line items from an uploaded invoice PDF and returns an editable
// preview without writing anything to the catalog.
export const importFromPdf = action({
  args: { storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { storageId, fileName }): Promise<ImportPreview> => {
    await requireAuth(ctx);
    const extracted = await ctx.runAction(api.invoices.parseInvoice, { storageId });
    const filtered = extracted.lineItems.filter(
      (item) => item.description.trim() !== "" && !PROFIT_RE.test(item.description.trim()),
    );
    return {
      storageId,
      fileName,
      lineItems: filtered,
      total: extracted.total,
      totalMismatchWarning: extracted.totalMismatchWarning,
    };
  },
});

// Ingests a confirmed (possibly user-edited) set of line items from a PDF
// import into the catalog via syncSource, then records the import.
export const confirmImport = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    lineItems: v.array(
      v.object({ description: v.string(), qty: v.number(), unitPrice: v.number() }),
    ),
  },
  handler: async (ctx, { storageId, fileName, lineItems }) => {
    await requireAuth(ctx);
    const now = Date.now();
    await syncSource(ctx, {
      sourceType: "import",
      sourceId: storageId,
      observedAt: now,
      lineItems,
    });
    const total = lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    const existing = await ctx.db
      .query("catalogImports")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { fileName, itemCount: lineItems.length, total, importedAt: now });
    } else {
      await ctx.db.insert("catalogImports", {
        storageId,
        fileName,
        itemCount: lineItems.length,
        total,
        importedAt: now,
      });
    }
  },
});
