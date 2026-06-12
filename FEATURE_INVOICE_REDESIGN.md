# Feature: Invoice PDF Redesign

Redesign the generated invoice PDF (`packages/backend/convex/lib/invoicePdf.ts`) to be simple, clean, and minimalistic, using weight and size — not boxes and fills — to create hierarchy.

## Hard constraints (packet workflow compatibility)

The packet workflow loads the invoice as raw PDF bytes from Convex storage and merges it into the final packet (`packets.ts:148-155`). It has **no knowledge of the invoice's internal layout**, so compatibility means:

1. **Do not change the exported API.** `buildInvoicePdf(input: InvoicePdfInput): Promise<PDFDocument>` and the `InvoicePdfInput` type stay exactly as they are. The only caller is `invoiceBuilder.ts:33`.
2. **Keep US Letter pages** (612 × 792). All other packet documents are letter-size; the merged packet must stay uniform.
3. **Keep multi-page overflow working.** Long line-item lists must continue to paginate (repeat the table header on new pages, never draw past the bottom margin).
4. **Keep the "Profit" row special-casing.** A line item whose description is exactly `"Profit"` renders qty as a percentage (`15%`) and leaves the unit-price column blank.
5. **Standard fonts only** (Helvetica / Helvetica-Bold via `StandardFonts`). No custom font embedding — keeps file size small and merge behavior predictable.

No frontend or schema changes are needed; this is a pure visual rework inside one file.

## Design direction

Minimal, typographic, lots of whitespace. Kill the boxed/striped "spreadsheet" look:

- **Remove** the dark filled table-header bar, zebra striping, and per-row cell borders.
- **Replace** with hairline rules and typographic contrast only.

### Palette

| Token | Value | Use |
|---|---|---|
| `INK` | `rgb(0.09, 0.10, 0.12)` | Primary text, totals |
| `MUTED` | `rgb(0.45, 0.47, 0.50)` | Secondary text, labels, addresses |
| `HAIRLINE` | `rgb(0.85, 0.86, 0.88)` | Row separators, dividers |
| `RULE` | `INK` | The two strong rules (under header, above total) |

All text gets an explicit `color` (currently most calls default to black — switch body to `INK`, secondary to `MUTED`).

### Type scale

| Element | Font | Size | Color |
|---|---|---|---|
| "INVOICE" title | Bold | 28 | INK |
| Invoice # / date values | Regular | 10 | INK |
| Section labels (`FROM`, `ISSUED TO`, `SAH CASE NUMBER`, column headers) | Bold | 7.5, uppercase | MUTED |
| Company / client name (first line of each block) | Bold | 11 | INK |
| Body / addresses / table cells | Regular | 10 | INK (values) / MUTED (addresses, phone, email) |
| Subtotal row | Regular | 10 | MUTED label, INK value |
| **TOTAL** row | Bold | 16 | INK |

### Layout (top to bottom)

1. **Header band**
   - Left: `INVOICE` at 28pt bold.
   - Right, right-aligned, stacked: invoice number (label `NO.` muted, value bold), issue date below (label `DATE` muted, value regular).
   - Below the band: a single **1pt INK rule** across the full content width. This is the strongest line on the page.
   - Generous gap (~28pt) after the rule.

2. **Parties — two columns** (same split as now at `MARGIN + TABLE_WIDTH / 2`)
   - `FROM` / `ISSUED TO` labels in the muted small-caps style.
   - First line (company name / client name) at 11pt bold INK. Drop the current `Name:` / `Address:` / `Zip Code:` prefixes on the client block — just render the values as clean address lines.
   - Remaining lines 10pt MUTED, line height 14.
   - Client block: `name`, `street`, `city, state zip`, `phone`.

3. **Case number row**
   - `SAH CASE NUMBER` muted small-caps label, value 10pt bold INK beside or below it.
   - ~24pt gap before the table.

4. **Line-item table**
   - Column header row: `DESCRIPTION  QTY  UNIT PRICE  AMOUNT` in the muted 7.5pt bold style, no fill rectangle. A **0.5pt HAIRLINE rule** below the header text.
   - Keep current column geometry (desc flexible, qty 50, unit 90, amount 90; numeric columns right-aligned) but indent text to `MARGIN` (no `+8` inset — there's no box to inset from).
   - Rows: 10pt, ~10pt vertical padding, separated by 0.5pt HAIRLINE rules (rule after each row). No background fills, no side borders.
   - Description wraps as today (`wrapLines`); amount stays right-aligned at the content edge.
   - Page overflow: repeat the column-header row (with its hairline) on continuation pages.

5. **Totals block** — right-aligned cluster, width ≈ the last two columns
   - `Subtotal` 10pt (MUTED label / INK value).
   - ~10pt gap, then a **1pt INK rule** spanning just the totals cluster.
   - `TOTAL` 16pt bold with the amount right-aligned at the content edge. This should be the second-loudest element on the page after the title.
   - `ensureSpace` for the whole block so it never splits across pages.

### Spacing rhythm

- Page margin: bump to 60pt for more whitespace.
- Body line height: 14.
- Major section gaps: 24–28pt. The page should feel airy; when in doubt, add space.

## Verification

- `bun run typecheck` (or the workspace equivalent) passes.
- Generate an invoice via the existing builder action with (a) 2 items, (b) enough items to force a second page, (c) a `Profit` line item — confirm pagination, profit-row rendering, and totals.
- Generate a full packet and confirm the invoice merges in unchanged order.
