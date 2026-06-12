"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { enumerateFields } from "./lib/pdf";
import { isPacketDataKey, KEY_DESCRIPTIONS } from "./lib/pdfFieldMap";

const SYSTEM_PROMPT =
  "You are a precise PDF form-field mapping assistant. Return ONLY valid JSON with no markdown, no explanation, and no extra text.";

function buildUserPrompt(templateKey: string, fieldNames: string[]): string {
  const catalog = Object.entries(KEY_DESCRIPTIONS)
    .map(([key, desc]) => `- ${key}: ${desc}`)
    .join("\n");
  return `This is a fillable PDF form used in a VA SAH (Specially Adapted Housing) grant
signature packet. The template is "${templateKey}". Map each of its AcroForm field
names to the data key it should be filled with.

Available data keys:
${catalog}

AcroForm field names in this template:
${fieldNames.map((n) => `- ${n}`).join("\n")}

Rules:
- Field names may contain misspellings (e.g. "Verteran", "Inpsection") — map by meaning.
- Numbered draw/inspection/payment amount fields map to drawNAmount by their number;
  only fields explicitly named "final" map to finalDrawAmount.
- OMIT fields that must stay blank for pen-and-ink completion at signing:
  * any date field (names containing "date", "day", "month", "year")
  * signature lines and printed-name lines next to signatures (e.g. bare "Veteran" or
    "Contractor" fields adjacent to Date fields)
  * construction/material detail fields with no matching data key (e.g. spec-sheet
    fields about insulation, framing, finishes)
- Only use keys from the list above. Omit a field rather than guess a poor match.

Return ONLY a JSON object mapping field name → data key, e.g.:
{"Veteran Name": "clientName", "1st Inspection Amount": "draw1Amount"}`;
}

function tryParseMapping(
  text: string,
  fieldNames: Set<string>,
): Record<string, string> | null {
  // Tolerate markdown fences or surrounding prose: extract the outermost object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const fieldMap: Record<string, string> = {};
  for (const [fieldName, key] of Object.entries(parsed)) {
    if (!fieldNames.has(fieldName)) continue;
    if (typeof key !== "string" || !isPacketDataKey(key)) continue;
    if (fieldName.toLowerCase().includes("date")) continue; // pen-filled, always
    fieldMap[fieldName] = key;
  }
  return fieldMap;
}

async function generateFieldMap(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
  label: string,
): Promise<Record<string, string>> {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new Error(`Template file missing from storage: ${label}`);

  const fields = await enumerateFields(await blob.arrayBuffer());
  if (fields.length === 0) return {};

  const fieldNames = fields.map((f) => f.name);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const callClaude = async () => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(label, fieldNames) }],
    });
    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  };

  const nameSet = new Set(fieldNames);
  let mapping = tryParseMapping(await callClaude(), nameSet);
  if (!mapping) {
    mapping = tryParseMapping(await callClaude(), nameSet);
  }
  if (!mapping) {
    throw new Error(`Could not generate a field mapping for template: ${label}`);
  }
  return mapping;
}

export const mapTemplateFields = internalAction({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const templates = await ctx.runQuery(internal.templates.listTemplatesInternal);
    const template = templates.find((t) => t.key === args.key);
    if (!template) throw new Error(`Template not uploaded: ${args.key}`);

    const fieldMap = await generateFieldMap(ctx, template.storageId, args.key);

    await ctx.runMutation(internal.templates.saveFieldMap, {
      templateId: template._id,
      fieldMap,
    });
    return fieldMap;
  },
});

export const mapCustomDocumentFields = internalAction({
  args: { id: v.id("customDocuments") },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const doc = await ctx.runQuery(internal.customDocuments.getCustomDocumentInternal, {
      id: args.id,
    });
    if (!doc) throw new Error("Custom document not found.");

    const fieldMap = await generateFieldMap(ctx, doc.storageId, doc.displayName);

    await ctx.runMutation(internal.customDocuments.saveCustomFieldMap, {
      id: args.id,
      fieldMap,
    });
    return fieldMap;
  },
});
