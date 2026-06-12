# Feature: Saved Invoices

## Overview

Invoices composed in the Invoice Builder become savable. A **Save** button persists the in-progress invoice to a new Convex `invoices` table, and a **Saved Invoices** button in the builder's title row navigates to a new `/invoices` page listing every saved invoice with **Download** and **Edit** actions. Editing opens `/invoice-builder?id=<invoiceId>` with the entire form (client, details, line items, profit row) pre-populated; saving again updates the same record rather than creating a duplicate.

The save stores the *editable* form data, not a PDF. PDFs are always built on demand from the current data (via the existing `invoiceBuilder.buildInvoice` action), so a downloaded invoice can never be stale relative to its last edit.

---

## UX Design

### Builder title row (`/invoice-builder`)

```
┌──────────────────────────────────────────────────────────────────┐
│  Invoice Builder                          [ 🗂 Saved Invoices ]   │
│  Compose a new invoice. Drag line items to set construction...   │
└──────────────────────────────────────────────────────────────────┘
```

- "Saved Invoices" is an `outline` button (FolderIcon or FilesIcon) linking to `/invoices`, right-aligned in the same flex row as the `<h1>`.
- When editing an existing invoice (`?id=` present), the subtitle changes to *"Editing {invoiceNumber}"* so the user knows Save will update, not create.

### Summary card actions

The summary card gains a **Save** button above the existing actions:

```
┌─ Invoice Summary ──────────┐
│ ...totals...               │
│                            │
│ [ 💾 Save Invoice        ] │   ← new (secondary/outline)
│ [ ↓ Download Invoice     ] │
│ [ Start Packet →         ] │
└────────────────────────────┘
```

- **Save** is enabled when `fields.name.trim() !== ""` — looser than `canBuild`, because saving an incomplete draft is the point of saving. Download/Start Packet keep the stricter `canBuild` validation.
- On success the button flashes a check / "Saved" state for ~1.5s (same pattern as the Settings save button) and a toast is unnecessary.
- After the first save of a new invoice, the page updates the URL to `/invoice-builder?id=<newId>` via `router.replace` so subsequent saves update the same record and a refresh doesn't lose the association.
- An "unsaved changes" dot or `*` next to the Save label when the form differs from the last-saved state is a nice touch; track it with the same `setBuilt(null)`-style invalidation already used for the PDF cache (one `dirty` boolean set in `setField` / `handleRowsChange`, cleared on save/load).

### Saved Invoices page (`/invoices`)

```
┌──────────────────────────────────────────────────────────────────┐
│  Saved Invoices                              [ + New Invoice ]   │
│  All invoices you've saved from the Invoice Builder.             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ INV-2026-014 · John Doe                                    │  │
│  │ $44,800.00 · 6 items · Updated Jun 12, 2026   [↓] [Edit]  │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ INV-2026-013 · Jane Smith                                  │  │
│  │ $12,500.00 · 3 items · Updated Jun 10, 2026   [↓] [Edit]  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

- Ordered by `updatedAt` descending. Card-list layout consistent with the dashboard client list (rounded-md border, divide-y rows).
- Each row: invoice number + client name, then total / item count / `formatDate(updatedAt)`, then actions.
- **Download** (icon button): calls `buildInvoice` with the stored data, then `downloadFile(url, "Invoice.pdf")` — identical flow to the builder's Download button, with a per-row spinner state.
- **Edit** (button): `router.push("/invoice-builder?id=" + invoice._id)`.
- Empty state: *"No saved invoices yet. Build one to get started."* with a button to `/invoice-builder`.
- "+ New Invoice" header button links to `/invoice-builder` (no `id` param → fresh form).

---

## Schema

New `invoices` table in `packages/backend/convex/schema.ts`:

```ts
invoices: defineTable({
  name: v.string(),
  street: v.string(),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  phone: v.string(),
  invoiceNumber: v.string(),
  caseNumber: v.string(),
  invoiceDate: v.string(),          // yyyy-mm-dd input value, formatted only at PDF time
  lineItems: v.array(lineItemValidator),  // last item is always the Profit row
  total: v.number(),                // denormalized for the list view
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_updatedAt", ["updatedAt"]),
```

Notes:

- `lineItems` reuses `lineItemValidator` (`description/qty/unitPrice/amount`). The profit row is stored as the **last** item: `description: "Profit"`, `qty` = the percentage, `unitPrice: 0`, `amount` = computed profit dollars. This matches exactly what `toVerifiedData()` already produces, so save/build/start-packet all share one representation.
- `invoiceDate` is stored as the raw `<input type="date">` value (`"2026-06-12"`), not the display string — the display string is derived (`formatDisplayDate`) wherever needed.
- No PDF `storageId` is stored. Downloads rebuild on demand; this avoids stale blobs after edits and orphan cleanup concerns.

---

## Backend API (`packages/backend/convex/invoiceBuilder.ts`)

All in the existing default-runtime file (a mutation/query cannot live in the `"use node"` `invoices.ts`).

### `saveInvoice` mutation (new)

```ts
export const saveInvoice = mutation({
  args: {
    id: v.optional(v.id("invoices")),   // present = update, absent = create
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
  handler: async (ctx, { id, ...data }) => {
    await requireAuth(ctx);
    const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
    const now = Date.now();
    if (id) {
      await ctx.db.patch(id, { ...data, total, updatedAt: now });
      return id;
    }
    return await ctx.db.insert("invoices", { ...data, total, createdAt: now, updatedAt: now });
  },
});
```

### `listInvoices` query (new)

`requireAuth`, then `ctx.db.query("invoices").withIndex("by_updatedAt").order("desc").take(200)`.

### `getInvoice` query (new)

`args: { id: v.id("invoices") }` → `requireAuth`, `ctx.db.get(id)` (returns `null` if deleted).

### `suggestInvoiceNumber` (updated)

Currently counts only `clients` rows with an `INV-{year}-` prefix. Saved invoices also consume numbers, so the suggestion should scan **both** tables and return `INV-{year}-{maxSeq + 1}`, parsing the numeric suffix instead of counting rows (counting breaks once saved invoices and generated clients overlap for the same invoice). Max-of-suffixes is also more robust to deletions than counting.

### `buildInvoice` (unchanged)

The list page's Download reuses it as-is.

---

## Frontend Changes

### `apps/web/src/app/(app)/invoice-builder/page.tsx`

1. Read `useSearchParams().get("id")`. Because the page uses `useSearchParams`, wrap the component in a `<Suspense>` boundary (Next requirement).
2. `const saved = useQuery(api.invoiceBuilder.getInvoice, id ? { id } : "skip")`.
3. Hydrate once when `saved` resolves (same `hydrated` flag pattern as Settings):
   - `fields` ← saved client/details fields; `invoiceDate` ← saved value.
   - `rows` ← `savedLineItemsToRows(saved.lineItems)`: every stored item becomes a `LineItemRow` with a fresh `crypto.randomUUID()` id and `String(qty)` / `String(unitPrice)`; the last item ("Profit") maps to the pinned profit row (`qty` = stored pct). If the last item is somehow not "Profit", append `createProfitRow()` as a guard.
   - Skip the `suggestInvoiceNumber` prefill when editing (the saved number wins).
   - If `saved === null` for a present `id` (deleted/bad link), toast and `router.replace("/invoice-builder")` to a fresh form.
4. New `handleSave`: build the same payload as `toVerifiedData()` plus `invoiceDate` and optional `id`, call `saveInvoice`, then `router.replace` with the returned id (first save only) and clear the dirty flag.
5. Title row: add the "Saved Invoices" link button; subtitle swap when editing.

### `apps/web/src/app/(app)/invoices/page.tsx` (new)

Client component: `useQuery(api.invoiceBuilder.listInvoices)`, `useAction(api.invoiceBuilder.buildInvoice)`, rows as described in UX. Per-row `downloadingId` state for the spinner. Reuses `formatCurrency`, `formatDate`, `downloadFile`.

### Shared helper

Move `formatDisplayDate` (currently private to the builder page) to `apps/web/src/lib/format.ts` so both the builder and the list page format `invoiceDate` identically when calling `buildInvoice`.

---

## Edge Cases & Constraints

| Case | Behavior |
|------|----------|
| Save with only a client name | Allowed — drafts may be incomplete. Download/Start Packet still gated by full `canBuild` |
| Edit link to a deleted invoice | `getInvoice` returns `null` → toast + redirect to fresh builder |
| Saving twice quickly | Save button disabled while the mutation is in flight |
| Start Packet from an edited-but-unsaved form | Uses live form state as today — saving is independent of packet generation; no auto-save |
| Duplicate invoice numbers | Still not enforced (matches existing behavior for `clients.invoiceNumber`); the improved `suggestInvoiceNumber` only reduces accidental reuse |
| Stored line items from before this feature | None exist (table is new) — no migration needed |
| Profit row drift (stored pct vs stored amount) | Amount is recomputed live from the hydrated rows in the editor, so the stored `amount` is only used for the list's `total` display |

---

## Out of Scope (explicitly)

- **Delete** from the saved invoices list (follow-up; trivial `deleteInvoice` mutation + confirm dialog when wanted).
- Linking a saved invoice to the `clients` row created when a packet is generated from it.
- Auto-save / save-on-navigate.
- Search/filter/pagination on `/invoices` (bounded `.take(200)` is fine at this scale).

---

## Implementation Order

1. Schema: `invoices` table + index.
2. `saveInvoice`, `listInvoices`, `getInvoice`; update `suggestInvoiceNumber`; codegen.
3. Move `formatDisplayDate` into `lib/format.ts`.
4. Builder page: Save button + dirty tracking, `?id=` hydration (with Suspense), title-row link, URL replace after first save.
5. `/invoices` list page with Download/Edit.
6. Verify: save new → appears in list → download from list → edit → change a line item → save → re-download shows the change → Start Packet from the edited invoice still works.
