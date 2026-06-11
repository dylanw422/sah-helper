export const DRAW_DEPENDENT_DOCS = [
  "construction-contract",
  "payment-schedule",
  "draw-schedule",
] as const;

export const STATIC_DOCS = ["va-addendum"] as const;

// Built programmatically at packet time (see lib/scopeOfWorkPdf.ts) — no
// uploaded template required.
export const GENERATED_DOCS = ["scope-of-work"] as const;

// Merge order is fixed: contract, payment schedule, draw schedule, addendum, scope of work.
// The builder spec sheet (VA 26-1852) is intentionally NOT part of the packet —
// the contractor fills it manually.
export const DOC_ORDER = [...DRAW_DEPENDENT_DOCS, ...STATIC_DOCS, ...GENERATED_DOCS] as const;

export type DocName = (typeof DOC_ORDER)[number];
export type GeneratedDocName = (typeof GENERATED_DOCS)[number];
export type UploadedDocName = Exclude<DocName, GeneratedDocName>;
export type DrawCount = 4 | 5 | 6;

export const TEMPLATE_KEYS = [
  "construction-contract-4draw",
  "construction-contract-5draw",
  "construction-contract-6draw",
  "payment-schedule-4draw",
  "payment-schedule-5draw",
  "payment-schedule-6draw",
  "draw-schedule-4draw",
  "draw-schedule-5draw",
  "draw-schedule-6draw",
  "va-addendum",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function getTemplateKey(docName: UploadedDocName, drawCount: DrawCount): TemplateKey {
  if ((DRAW_DEPENDENT_DOCS as readonly string[]).includes(docName)) {
    return `${docName}-${drawCount}draw` as TemplateKey;
  }
  return docName as TemplateKey;
}
