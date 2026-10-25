export const DRAW_DEPENDENT_DOCS = [
  "construction-contract",
  "payment-schedule",
] as const;

// Built programmatically at packet time (see lib/scopeOfWorkPdf.ts and
// lib/constructionStageCompletionPdf.ts) — no uploaded template required.
// construction-stage-completion emits one document per draw.
export const GENERATED_DOCS = ["scope-of-work", "construction-stage-completion"] as const;

// Merge order is fixed: contract, custom contract documents (spliced in by
// packets.ts right after the contract), addendum, scope of work, the
// construction stage completion docs (one per draw), then the invoice and any
// selected waivers/spec sheets (also spliced in by packets.ts), lien releases
// (one per draw, spliced in by packets.ts), with the payment schedule always
// last.
// The builder spec sheet (VA 26-1852) is intentionally NOT part of the packet —
// the contractor fills it manually.
export const DOC_ORDER = [
  "construction-contract",
  "va-addendum",
  "scope-of-work",
  "construction-stage-completion",
  "lien-release",
  "payment-schedule",
] as const;

export type DocName = (typeof DOC_ORDER)[number];
export type GeneratedDocName = (typeof GENERATED_DOCS)[number];
export type UploadedDocName = Exclude<DocName, GeneratedDocName>;
export type DrawCount = 4 | 5 | 6;

export const STANDARD_PACKET_DOCUMENTS = [
  { key: "va-addendum", name: "VA Addendum", detail: "One copy per packet" },
  { key: "scope-of-work", name: "Scope of Work", detail: "Generated from the invoice" },
  { key: "construction-stage-completion", name: "Construction Stage Completion", detail: "One copy per draw" },
  { key: "lien-release", name: "Lien Release", detail: "One copy per draw" },
  { key: "invoice", name: "Invoice", detail: "The invoice used to create the packet" },
  { key: "payment-schedule", name: "Payment Schedule", detail: "The schedule matching the packet's draw count" },
] as const;

export type StandardPacketDocumentKey = (typeof STANDARD_PACKET_DOCUMENTS)[number]["key"];

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
