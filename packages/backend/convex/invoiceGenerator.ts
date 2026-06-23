"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { MAX_GRANT_AMOUNT } from "./lib/grant";

const SYSTEM_PROMPT =
  "You are a construction estimator for VA SAH (Specially Adapted Housing) grant projects. Return ONLY valid JSON with no markdown, no explanation, and no extra text.";

type CatalogItem = {
  _id: string;
  canonicalDescription: string;
  unit: string | undefined;
  representativePrice: number;
  occurrences: number;
};

type GeneratedItem = {
  description: string;
  qty: number;
  unitPrice: number;
  catalogItemId: string | null;
  isEstimate: boolean;
};

export type GenerateResult = {
  items: GeneratedItem[];
  total: number;
  exceedsGrant: boolean;
  notes: string[];
};

function buildPrompt(description: string, catalog: CatalogItem[]): string {
  const catalogLines =
    catalog.length > 0
      ? catalog
          .map(
            (item, i) =>
              `${i + 1}. [ID:${item._id}] "${item.canonicalDescription}"${item.unit ? ` (per ${item.unit})` : ""} — $${item.representativePrice.toFixed(2)} (used ${item.occurrences}x)`,
          )
          .join("\n")
      : "(empty — no prior invoices yet)";

  return `You are a construction estimator creating a line-item invoice for a VA SAH (Specially Adapted Housing) home modification project.

JOB DESCRIPTION:
${description}

PRICING REFERENCE (historical prices from prior invoices — use these as your basis):
${catalogLines}

RULES:
1. Write short, action-oriented descriptions — a verb phrase saying what is being done, nothing more. No methodology, no standards references, no explanations. Examples of the right style: "Remove damaged subfloor", "Repair floor joists", "Widen and install new doors", "New 3x5 curbless shower", "Install grab bars", "Drywall and paint bathroom". A little specificity is fine (dimensions, material) but keep it to one short phrase per item.
2. Use the catalog as a pricing reference: if similar work appears in the catalog, use that price range to inform your unit price. Set "catalogItemId" to the matching [ID:...] and "isEstimate" to false.
3. For work with no close catalog match, estimate a realistic unit price based on national residential construction rates. Set "catalogItemId" to null and "isEstimate" to true.
4. List items in construction order (demo → rough-in → finish), since downstream draws are split in this order.
5. Do NOT add a profit or overhead line — the builder handles the profit percentage separately.
6. The target invoice total is between $115,000 and $${MAX_GRANT_AMOUNT.toLocaleString()} (the VA SAH grant maximum). Aim for this range. If the described scope would fall short, look for additional reasonable work items implied by the description. If it genuinely exceeds the cap, still return the full itemization and add a note.
7. Add 1–3 short "notes" (one sentence each, no catalog IDs). Only flag things the contractor actually needs to know: how many items were estimated vs. catalog-priced, any significant assumptions, and whether the total is near or over the grant cap. Skip notes if there is nothing meaningful to say.

Return ONLY this JSON:
{"items":[{"description":"string","qty":number,"unitPrice":number,"catalogItemId":"string or null","isEstimate":boolean}],"notes":["string"]}`;
}

type RawItem = {
  description?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  catalogItemId?: unknown;
  isEstimate?: unknown;
};

function tryParse(text: string): { items: GeneratedItem[]; notes: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const raw = parsed as { items?: unknown; notes?: unknown };
  if (!Array.isArray(raw.items)) return null;

  const items: GeneratedItem[] = [];
  for (const entry of raw.items as RawItem[]) {
    if (typeof entry.description !== "string" || !entry.description.trim()) continue;
    const qty = typeof entry.qty === "number" ? entry.qty : parseFloat(String(entry.qty)) || 1;
    const unitPrice =
      typeof entry.unitPrice === "number"
        ? entry.unitPrice
        : parseFloat(String(entry.unitPrice)) || 0;
    const catalogItemId =
      typeof entry.catalogItemId === "string" && entry.catalogItemId ? entry.catalogItemId : null;
    const isEstimate = typeof entry.isEstimate === "boolean" ? entry.isEstimate : catalogItemId === null;
    items.push({ description: entry.description.trim(), qty, unitPrice, catalogItemId, isEstimate });
  }

  const notes = Array.isArray(raw.notes)
    ? (raw.notes as unknown[]).filter((n): n is string => typeof n === "string")
    : [];

  return items.length > 0 ? { items, notes } : null;
}

export const generateLineItems = action({
  args: {
    description: v.string(),
  },
  handler: async (ctx, { description }): Promise<GenerateResult> => {
    await requireAuth(ctx);

    const catalog: CatalogItem[] = await ctx.runQuery(internal.catalog.listItemsForGeneration);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildPrompt(description, catalog);

    const callClaude = async () => {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    };

    let parsed = tryParse(await callClaude());
    if (!parsed) {
      parsed = tryParse(await callClaude());
    }
    if (!parsed) {
      return {
        items: [],
        total: 0,
        exceedsGrant: false,
        notes: ["Could not derive line items from the description. Please try rephrasing."],
      };
    }

    const planAndSpec: GeneratedItem = {
      description: "Plan and spec job",
      qty: 1,
      unitPrice: 2500,
      catalogItemId: null,
      isEstimate: false,
    };

    const items = [planAndSpec, ...parsed.items];

    // Recompute total server-side — never trust model arithmetic.
    const total = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

    return {
      items,
      total,
      exceedsGrant: total >= MAX_GRANT_AMOUNT,
      notes: parsed.notes,
    };
  },
});
