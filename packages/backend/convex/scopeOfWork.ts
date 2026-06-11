"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { WORK_AREAS, type ScopeSection, type WorkArea } from "./lib/scopeOfWorkPdf";
import { lineItemValidator } from "./schema";

const SYSTEM_PROMPT =
  "You are a construction scope-of-work writer for VA SAH (Specially Adapted Housing) grant packets. Return ONLY valid JSON with no markdown, no explanation, and no extra text.";

function buildUserPrompt(
  lineItems: { description: string; qty: number; amount: number }[],
): string {
  return `These are the line items from a contractor's invoice for a VA SAH home
modification project:
${lineItems.map((item) => `- ${item.description} (qty ${item.qty}, $${item.amount.toFixed(2)})`).join("\n")}

Write a Scope of Work document. Group the work into these areas, in this order:
${WORK_AREAS.join(", ")}.

Rules:
- ONLY include actual physical construction work. EXCLUDE entirely any line items for
  contractor profit, overhead, or fees; architectural plans, drawings, or project
  specifications; permitting; VA SAH grant approval or administration; design or
  project-management services. These are not part of the scope of work.
- Cover every construction line item exactly once. Do not invent work that is not on
  the invoice.
- For each entry, write 1-2 plain sentences explaining the work to be performed,
  expanding terse invoice wording into a clear description a VA reviewer can understand.
- Closely related line items may be combined into a single entry.
- Only include areas that have work. Use "Other" for construction items that fit no
  other area.

Return ONLY JSON in this shape:
{"sections":[{"area":"Framing","items":["Frame new walls for the accessible bathroom addition.","..."]}]}`;
}

function tryParseSections(text: string): ScopeSection[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const sections = (parsed as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return null;

  const areas = WORK_AREAS as readonly string[];
  const itemsByArea = new Map<WorkArea, string[]>();
  for (const section of sections) {
    if (typeof section !== "object" || section === null) continue;
    const { area, items } = section as { area?: unknown; items?: unknown };
    if (typeof area !== "string" || !Array.isArray(items)) continue;
    const validArea = (areas.includes(area) ? area : "Other") as WorkArea;
    const texts = items.filter((item): item is string => typeof item === "string" && !!item.trim());
    if (texts.length === 0) continue;
    itemsByArea.set(validArea, [...(itemsByArea.get(validArea) ?? []), ...texts]);
  }

  const result = WORK_AREAS.filter((area) => itemsByArea.has(area)).map((area) => ({
    area,
    items: itemsByArea.get(area)!,
  }));
  return result.length > 0 ? result : null;
}

export const generateScopeSections = internalAction({
  args: { lineItems: v.array(lineItemValidator) },
  handler: async (ctx, args): Promise<ScopeSection[]> => {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const callClaude = async () => {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(args.lineItems) }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    };

    let sections = tryParseSections(await callClaude());
    if (!sections) {
      sections = tryParseSections(await callClaude());
    }
    if (!sections) {
      throw new Error("Could not generate the Scope of Work from the invoice line items.");
    }
    return sections;
  },
});
