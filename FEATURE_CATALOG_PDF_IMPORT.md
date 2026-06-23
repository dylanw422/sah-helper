# Feature: Import Pricing Catalog from an Invoice PDF

## Overview

Let the contractor **upload a PDF of an existing invoice** (one written outside this app —
from QuickBooks, a Word template, a competitor's bid they want to price-match, an old paper
invoice scanned to PDF) and have the app **extract every line item and its unit price** and
fold them into the **Pricing Catalog** (`FEATURE_PRICING_CATALOG.md`).

This closes the last gap in catalog learning. Today the catalog grows automatically, but
only from invoices that are **built or saved inside the app** (Invoice Builder) or from
packet clients. A contractor with years of prior invoices has no way to seed their price
book without re-typing each one. PDF import lets them bring that pricing history in with a
drag-and-drop, so AI generation has real numbers from day one.

The extracted prices flow through the **same idempotent ingestion path** the rest of the
catalog uses (`catalog.syncSource`), so an imported invoice behaves exactly like a saved
one: items roll up by `matchKey`, stats recompute, profit rows are excluded, and a re-import
of the same file never double-counts.

---

## Why this is mostly already built

The hard parts already exist and should be **reused, not reinvented**:

- **PDF → structured line items.** `invoices.parseInvoice` (`packages/backend/convex/invoices.ts`)
  already takes a `_storage` id, reads the PDF, sends it to Claude as a `document` content
  block, and returns `{ lineItems: [{ description, qty, unitPrice, amount }], ... }` with a
  JSON parse + one retry + a total-mismatch check. This is the exact extraction we need.
- **File upload.** `uploads.generateUploadUrl` + the existing wizard upload step
  (`apps/web/src/components/wizard/upload-step.tsx`, `file-drop-zone.tsx`) already cover
  picking a PDF, uploading to Convex storage, and getting a `storageId`.
- **Catalog ingestion.** `catalog.syncSource` already turns a `{ description, qty, unitPrice }[]`
  list into catalog items + price observations, idempotently keyed by `(sourceType, sourceId)`.

So this feature is mostly **wiring**: a small UI entry point on `/catalog`, a new
`sourceType` for the catalog, and one thin action (or mutation) that calls extraction then
`syncSource`.

---

## Goals

1. **Upload** an invoice PDF from the `/catalog` page and extract its line items + prices.
2. **Preview** the extracted items and let the contractor correct obvious OCR/parse errors
   before they enter the catalog (extraction is AI, not infallible).
3. **Ingest** the confirmed items through `syncSource` so they merge with existing catalog
   pricing and recompute stats correctly.
4. **Stay idempotent** — re-importing the same PDF (or re-confirming) replaces that import's
   observations rather than stacking them.
5. **Reuse** the existing extraction action, upload plumbing, and catalog ingestion — add
   the minimum new surface area.

---

## Data Model

No new tables. One additive change to the existing catalog ingestion source type.

### Extend `priceObservations.sourceType`

`syncSource`'s `sourceType` and the `priceObservations` schema currently allow
`"invoice" | "client"`. Add a third source so imported PDFs are tracked distinctly and can
be re-synced / retracted on their own:

```ts
sourceType: v.union(
  v.literal("invoice"),
  v.literal("client"),
  v.literal("import"),   // ← new: an uploaded invoice PDF, not a saved app invoice
),
```

`sourceId` for an import is the `_storage` id of the uploaded PDF (stringified), which is
naturally unique per upload and gives idempotency for free: confirming the same upload twice
re-syncs the same `sourceId` instead of duplicating.

### Optional: a lightweight `catalogImports` table (recommended)

To give the contractor a record of what they imported (and an undo), persist one row per
confirmed import:

```ts
catalogImports: defineTable({
  storageId: v.id("_storage"),     // the uploaded PDF (also the syncSource sourceId)
  fileName: v.string(),            // original filename, for display
  itemCount: v.number(),           // number of line items ingested
  total: v.number(),               // sum of amounts, for display
  importedAt: v.number(),
}).index("by_importedAt", ["importedAt"]),
```

If this table is included, deleting an import row should call `syncSource` with empty line
items for that `sourceId` (retracting its observations) before deleting the row and the
stored file — mirroring `invoiceBuilder.deleteInvoice`. If we want to keep scope minimal,
this table can be omitted in v1 and the import treated as fire-and-forget; the tradeoff is
no per-import undo (the contractor would edit/delete individual catalog items instead).

No changes to `catalogItems`.

---

## Backend

### Reuse `invoices.parseInvoice` for extraction

Do **not** write a second PDF-parsing prompt. The existing `parseInvoice` action already
returns the line items we need. Two shapes are possible:

**Option A (preferred) — refactor extraction into a shared helper.** Pull the PDF →
`lineItems` logic out of `parseInvoice` into an internal helper
(`extractInvoiceFromPdf(ctx, storageId)`), and have both `parseInvoice` (packet flow) and the
new catalog-import action call it. Avoids prompt drift between the two callers.

**Option B (minimal) — call the existing action.** The new import action calls
`ctx.runAction(api.invoices.parseInvoice, { storageId })` and uses only `result.lineItems`,
ignoring the client/address fields. Slightly wasteful (extracts fields we discard) but zero
refactor.

### New action: `catalog.importFromPdf`

```ts
// node action (extraction is AI); lives alongside the extraction it reuses.
export const importFromPdf = action({
  args: { storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { storageId, fileName }): Promise<ImportPreview> => { … },
});

type ExtractedLine = { description: string; qty: number; unitPrice: number; amount: number };
type ImportPreview = {
  storageId: string;
  fileName: string;
  lineItems: ExtractedLine[];   // profit/blank rows already stripped
  total: number;
  totalMismatchWarning: boolean;
};
```

`importFromPdf` extracts (Option A/B above), strips the profit row and blanks (same rule
`syncSource` applies — `description === "profit"` case-insensitive, empty description), and
**returns a preview without writing to the catalog**. Writing is a separate confirm step so
the contractor can fix extraction errors first.

### New mutation: `catalog.confirmImport`

```ts
export const confirmImport = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    // The (possibly user-edited) line items from the preview.
    lineItems: v.array(v.object({
      description: v.string(),
      qty: v.number(),
      unitPrice: v.number(),
    })),
  },
  handler: async (ctx, { storageId, fileName, lineItems }) => {
    await requireAuth(ctx);
    await syncSource(ctx, {
      sourceType: "import",
      sourceId: storageId,            // stringified id → idempotent per upload
      observedAt: Date.now(),
      lineItems,
    });
    // If catalogImports table is included:
    //   upsert a catalogImports row keyed by storageId (itemCount, total, importedAt).
  },
});
```

Because ingestion goes through `syncSource`, all existing catalog behavior is inherited for
free: `matchKey` rollup, stat recompute, profit exclusion, `priceLocked` preservation.

---

## UI

### Entry point on `/catalog`

This feature **fills the gap left by removing the "Rebuild from invoices" button**. The
catalog now auto-populates from saved invoices, so the header's secondary action becomes
**"Import from PDF"** instead — a real new capability rather than a redundant rebuild.

```
┌─ Pricing Catalog ──────────────────────────────────────────────────────┐
│  137 items learned from your invoices                                   │
│                                   [ ⬆ Import from PDF ]  [ + New Invoice ]│
└────────────────────────────────────────────────────────────────────────┘
```

### Import dialog

Clicking **Import from PDF** opens a dialog with three states:

**1. Pick / drop.** Reuse `file-drop-zone.tsx` (PDF only, `accept="application/pdf"`).
On selection: `generateUploadUrl` → `PUT` the file → get `storageId` → call
`importFromPdf({ storageId, fileName })`. Button shows a spinner + "Reading invoice…"
during extraction (settled-state UI per the quiet-UI preference — one spinner, no
play-by-play).

**2. Preview + correct.** Render the extracted `lineItems` in a compact editable table —
the same row controls the Invoice Builder uses (description / qty / unit price), so the
contractor can fix a misread price or delete a junk row before importing:

```
┌─ Review extracted items ───────────────────────────────────────────────┐
│  invoice-2024-bathroom.pdf · 8 items · $14,250.00                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Description                          Qty    Unit price             │  │
│  │ Demo existing bathroom               1      $4,500.00          🗑  │  │
│  │ Tile shower install                  48     $95.00            🗑  │  │
│  │ Comfort-height toilet                1      $410.00           🗑  │  │
│  │ …                                                                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ⚠ Line items don't sum to the invoice total — double-check prices.    │
│                                          [ Cancel ]  [ Add to Catalog ] │
└────────────────────────────────────────────────────────────────────────┘
```

- Show `totalMismatchWarning` as an amber inline note (not a blocker).
- "Add to Catalog" calls `confirmImport` with the current (edited) rows.

**3. Done.** Close the dialog; the catalog list (live `useQuery`) reflects new/updated items
immediately. `toast.success("Imported 8 items from invoice-2024-bathroom.pdf.")`. Errors
(extraction failure, upload failure) via `toast.error`, matching existing handlers.

### Empty-state nudge

The `/catalog` empty state currently says it fills in as invoices are saved. Add a secondary
line/link: "…or import an existing invoice PDF to seed your pricing." pointing at the same
import dialog, so a brand-new user can populate the catalog before building anything.

---

## Backend API summary

`packages/backend/convex/catalog.ts` (+ extraction reuse from `invoices.ts`):

| Export | Kind | Purpose |
|--------|------|---------|
| `importFromPdf` | action (node) | upload's `storageId` → extract via existing PDF parser → return editable preview (no write) |
| `confirmImport` | mutation | ingest confirmed/edited line items through `syncSource` (sourceType `"import"`) |
| `deleteImport` *(if `catalogImports` included)* | mutation | retract an import's observations + remove its row/file |

Reused as-is: `uploads.generateUploadUrl`, `catalog.syncSource`, the `parseInvoice`
extraction prompt/logic.

Schema change: extend `priceObservations.sourceType` with `"import"`; optionally add
`catalogImports`.

No changes to the packet pipeline, PDF layouts, or AI invoice generation — imported prices
feed generation simply by being in the catalog.

---

## Edge Cases & Constraints

| Case | Behavior |
|------|----------|
| Same PDF imported twice | `sourceId = storageId` makes `syncSource` idempotent; the second import re-syncs the same observations instead of doubling occurrences |
| Scanned / image-only PDF | Claude's document understanding handles most scans; if extraction yields no line items, preview shows "No line items found — check the file or add prices manually," no write |
| Profit / overhead / fee rows on the PDF | Stripped before preview (same exclusion `syncSource` uses); never enter the catalog |
| Line items don't sum to the printed total | `totalMismatchWarning` surfaces as an amber note in the preview; non-blocking — the contractor can still import |
| Bad price extracted (e.g. "$1,200" read as 1200 vs 12.00) | Preview is editable; the contractor fixes it before "Add to Catalog" |
| Non-invoice PDF uploaded | Extraction returns no usable line items → preview shows the empty-result message; nothing is written |
| Very large / multi-page invoice | `parseInvoice` already runs at `max_tokens: 4096`; cap or warn if extraction is truncated (carry over the existing action's limits) |
| Currency / number coercion | Reuse the existing `toNumber` coercion in `invoices.ts` ("$1,200.00" → 1200) so import matches the packet flow exactly |
| Import then later edit catalog price | Normal catalog editing applies; `priceLocked` items are preserved by `syncSource` regardless of imports |

---

## Out of Scope

- **Bulk / multi-file import** in one action — v1 is one PDF per dialog (loop the dialog for
  more). Multi-select can come later if needed.
- **Importing non-PDF formats** (CSV, XLSX, images) — PDF only, reusing the existing parser.
- **Auto-creating a saved app invoice** from the import — this feature feeds the *catalog*
  only; if the contractor wants an editable invoice, that's the existing builder flow.
- **Field extraction beyond line items** (client, dates, totals) — those are discarded; the
  packet wizard already covers full-invoice extraction.
- **Reconciling an imported item against an existing saved invoice** — imports are an
  independent observation source; no cross-linking.

---

## Implementation Order

1. Schema: add `"import"` to `priceObservations.sourceType` (and `catalogImports` table if
   included). Update the `syncSource` arg type to accept `"import"`.
2. Extraction reuse: refactor `invoices.parseInvoice`'s PDF→lineItems into a shared helper
   (Option A), or plan to call the action directly (Option B).
3. `catalog.importFromPdf` action: extract → strip profit/blanks → return `ImportPreview`.
4. `catalog.confirmImport` mutation: `syncSource` with `sourceType: "import"`; upsert
   `catalogImports` if present.
5. `/catalog` UI: replace the (now-removed) rebuild action with an **Import from PDF**
   button + dialog reusing `file-drop-zone` and the builder's editable line-item rows.
6. Empty-state link to the import dialog.
7. End-to-end: upload a real prior invoice PDF → confirm extracted items appear in preview →
   edit a price → Add to Catalog → confirm the items merge by `matchKey` and stats recompute
   → re-import the same file and confirm no double-counting.
