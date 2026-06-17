export const DRAW_DEPENDENT_DOCS = [
  "construction-contract",
  "payment-schedule",
] as const;

// Built programmatically at packet time (see lib/scopeOfWorkPdf.ts) — no
// uploaded template required.
export const GENERATED_DOCS = ["scope-of-work"] as const;

// Merge order is fixed: contract, custom contract documents (spliced in by
// packets.ts right after the contract), addendum, scope of work, then the
// invoice and any selected waivers/spec sheets (also spliced in by packets.ts),
// lien releases (one per draw, spliced in by packets.ts), with the payment
// schedule always last.
// The builder spec sheet (VA 26-1852) is intentionally NOT part of the packet —
// the contractor fills it manually.
export const DOC_ORDER = [
  "construction-contract",
  "va-addendum",
  "scope-of-work",
  "lien-release",
  "payment-schedule",
] as const;

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
  "va-addendum",
  "lien-release",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function getTemplateKey(docName: UploadedDocName, drawCount: DrawCount): TemplateKey {
  if ((DRAW_DEPENDENT_DOCS as readonly string[]).includes(docName)) {
    return `${docName}-${drawCount}draw` as TemplateKey;
  }
  return docName as TemplateKey;
}
