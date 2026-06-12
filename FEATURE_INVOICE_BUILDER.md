# Feature: Invoice Builder

## Overview

A professional, in-app invoice builder at `/invoice-builder`. Instead of receiving a PDF invoice from elsewhere and running it through AI extraction, the contractor composes the invoice directly in the app: client details, SAH case number, and line items with qty × unit price. Contractor information is pulled automatically from Settings. Line items can be reordered via drag and drop (construction order matters — draws are split in line-item order).

The builder produces a pixel-consistent invoice PDF rendered server-side with `pdf-lib` (same pattern as `lib/scopeOfWorkPdf.ts`). From the final screen the user can:

1. **Download** the invoice PDF, and/or
2. **Start Packet** — jump straight into the existing `/new-packet` wizard with all data pre-filled and **AI extraction skipped entirely**, since the data is already structured.

Because the invoice is born structured, the packet flow loses its only lossy step (AI parsing) when it starts from the builder. The generated PDF is still laid out so `invoices.parseInvoice` could read it perfectly if it were ever re-uploaded by hand.

---

## UX Design

### Navigation

Add a nav item in `apps/web/src/components/header.tsx` between Clients and New Packet (it precedes packet creation in the real workflow):

```ts
const NAV_ITEMS: { href: Route; label: string }[] = [
  { href: "/dashboard", label: "Clients" },
  { href: "/invoice-builder", label: "Invoice Builder" },
  { href: "/new-packet", label: "New Packet" },
  { href: "/settings", label: "Settings" },
];
```

### Page layout (`/invoice-builder`)

Two-column on desktop (form left, live preview summary right), single column stacked on mobile. Reuses the existing `Card` / `Input` / `Label` / `Table` components from `@sah-helper/ui` so it is visually indistinguishable from the Verify step.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Invoice Builder                                                     │
│  Compose a new invoice. Drag line items to set construction order.   │
│                                                                      │
│  ┌─ From (Contractor) ────────────────┐  ┌─ Invoice Summary ──────┐  │
│  │ Access Innovations                  │  │ Invoice #  INV-2026-014│  │
│  │ William Gray · License #12345       │  │ Date       06/12/2026  │  │
│  │ 123 Main St, Tulsa, OK 74101        │  │ Items      6           │  │
│  │ (918) 555-0100 · will@access.com    │  │ Subtotal   $44,800.00  │  │
│  │              [Edit in Settings →]   │  │ Holdback   $8,960.00   │  │
│  └─────────────────────────────────────┘  │ ──────────────────     │  │
│                                           │ Total      $44,800.00  │  │
│  ┌─ Bill To (Client) ─────────────────┐   │                        │  │
│  │ Client Name      [____________]     │  │ [ ↓ Download Invoice ] │  │
│  │ Street Address   [____________]     │  │ [ Start Packet →     ] │  │
│  │ City [_____] State [__] Zip [____]  │  └────────────────────────┘  │
│  │ Phone Number     [____________]     │                              │
│  └─────────────────────────────────────┘                              │
│                                                                      │
│  ┌─ Invoice Details ──────────────────────────────────────────────┐  │
│  │ Invoice Number [INV-2026-014]   SAH Case Number [___________]  │  │
│  │ Invoice Date   [06/12/2026  ]                                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Line Items ───────────────────────────────────────────────────┐  │
│  │  ⠿  Demo existing bathroom            1   $4,500.00   $4,500.00│  │
│  │  ⠿  Rough-in plumbing                 1   $6,200.00   $6,200.00│  │
│  │  ⠿  Tile shower install              80      $95.00   $7,600.00│  │
│  │  ⠿  ...                                                    🗑  │  │
│  │  [+ Add Line Item]                                              │  │
│  │                                          Subtotal    $44,800.00│  │
│  │                                          Holdback(20%) $8,960.00│ │
│  │                                          Total       $44,800.00│  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Contractor card ("From")

- Read-only. Populated from `useQuery(api.settings.getSettings)`.
- Shows company name, contractor name, license, full address, phone, email — exactly the fields `generatePacket` consumes.
- "Edit in Settings →" links to `/settings`.
- **If settings are not configured** (`getSettings` returns `null`), the whole form is replaced by an empty state mirroring the error `generatePacket` throws: *"Contractor settings are not configured. Visit Settings before building invoices."* with a button to `/settings`.

### Client card ("Bill To")

Same field set and labels as the Verify step (`verify-step.tsx` `clientFields`): Client Name, Street Address, City, State, Zip Code, Phone Number. All free-text `Input`s.

### Invoice Details card

| Field | Behavior |
|-------|----------|
| Invoice Number | Pre-filled with a suggested `INV-{YYYY}-{NNN}` (see Numbering below). Editable. |
| Invoice Date | Defaults to today, native date input. Printed on the PDF only — not stored on `clients`. |
| SAH Case Number | Required (same rule as the wizard: `caseNumber.trim() !== ""`). Same helper placeholder as verify step. |

### Line Items card

- Columns: **drag handle ⠿ · Description · Qty · Unit Price · Amount (computed, read-only) · delete**.
- `Amount = qty × unitPrice`, formatted with the shared `formatCurrency` from `apps/web/src/lib/format.ts`. Same `parseFloat(x) || 0` coercion as `verify-step.tsx` `rowAmount`.
- **Drag and drop reorder** via `Reorder.Group` / `Reorder.Item` from `motion/react` — already a dependency, matches the app's animation system, no new package. The drag handle uses `useDragControls` so dragging never fights with text selection inside the inputs. Keyboard fallback: retain the up/down arrow buttons pattern from `verify-step.tsx` inside the row overflow (drag-only reordering is an accessibility regression).
- Helper text under the title (same copy intent as verify step): *"List items in construction order (demo before install, etc.) — draws are split in this order."*
- "+ Add Line Item" appends `{ description: "", qty: "1", unitPrice: "0" }`.
- Footer totals: Subtotal, Final Draw Holdback (20%) — informational, computed as `total * 0.2` like verify step — and Total.
- **Soft warning at > 10 items**: the contract templates render at most `lineItem1–10` (see `buildLineItemFields` in `packets.ts`). Show an amber banner: *"Only the first 10 line items appear itemized on the contract templates."* Do not block.

### Action buttons (summary card)

| Button | Enabled when | Action |
|--------|--------------|--------|
| **Download Invoice** | form valid | Build PDF (see backend), then trigger a browser download of `Invoice.pdf` |
| **Start Packet →** | form valid | Build PDF, stash the handoff draft, `router.push("/new-packet")` |

Validation (mirror of `canGenerate` in `verify-step.tsx`): client name, street, and case number non-empty; at least one line item with a non-empty description. Both buttons show a spinner state while the build action runs.

---

## Generated Invoice PDF

New module: `packages/backend/convex/lib/invoicePdf.ts`, following the `scopeOfWorkPdf.ts` conventions (Letter 612×792, 54pt margins, Helvetica/Helvetica-Bold, `wrapLines` text wrapping, multi-page overflow via `ensureSpace`).

```
┌──────────────────────────────────────────────────┐
│  INVOICE                          INV-2026-014   │
│                                   June 12, 2026  │
│  ──────────────────────────────────────────────  │
│  FROM                       BILL TO              │
│  Access Innovations         John Doe             │
│  William Gray               456 Oak Ave          │
│  License #12345             Tulsa, OK 74105      │
│  123 Main St                (918) 555-0123       │
│  Tulsa, OK 74101                                 │
│  (918) 555-0100                                  │
│  will@access.com                                 │
│                                                  │
│  SAH Case Number: 12-345-678                     │
│  ──────────────────────────────────────────────  │
│  DESCRIPTION                QTY  UNIT PRICE  AMT │
│  Demo existing bathroom       1   $4,500.00  ... │
│  Rough-in plumbing            1   $6,200.00  ... │
│  ...                                             │
│  ──────────────────────────────────────────────  │
│                            Subtotal   $44,800.00 │
│                            Total      $44,800.00 │
└──────────────────────────────────────────────────┘
```

Layout requirements:

- Zebra-striped table rows, right-aligned monetary columns, descriptions wrap.
- Every field that `invoices.parseInvoice` extracts must appear with an explicit label (client name/address/phone, invoice number, case number, qty, unit price, amount, total) so a re-uploaded builder invoice round-trips through AI extraction losslessly.
- Currency rendered with the same `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` used in `packets.ts`.

```ts
export async function buildInvoicePdf(input: {
  invoiceNumber: string;
  invoiceDate: string;        // pre-formatted display date
  caseNumber: string;
  client: { name: string; street: string; city: string; state: string; zip: string; phone: string };
  contractor: {               // shape of the settings table row
    contractorCompanyName: string; contractorName: string; contractorStreet: string;
    contractorCity: string; contractorState: string; contractorZip: string;
    contractorPhone: string; contractorEmail: string; contractorLicense: string;
  };
  lineItems: { description: string; qty: number; unitPrice: number; amount: number }[];
}): Promise<PDFDocument>
```

---

## Backend API Changes

### `invoices.ts` — `buildInvoice` action (new)

```ts
export const buildInvoice = action({
  args: {
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.string(),
    invoiceDate: v.string(),
    lineItems: v.array(lineItemValidator),   // reuse from schema.ts
  },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage">; url: string }> => {
    await requireAuth(ctx);
    const settings = await ctx.runQuery(api.settings.getSettings);
    if (!settings) throw new Error("Contractor settings are not configured. Visit Settings before building invoices.");
    const doc = await buildInvoicePdf({ ...args mapped..., contractor: settings });
    const bytes = await doc.save();
    const storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const url = (await ctx.storage.getUrl(storageId))!;
    return { storageId, url };
  },
});
```

Notes:

- The returned `storageId` is exactly what `generatePacket` already accepts as `invoiceStorageId` — the packet pipeline needs **zero changes**. The invoice lands in the packet just before the Payment Schedule and is registered as the client's `Invoice.pdf` file, same as an uploaded invoice today.
- The returned `url` powers the Download button (client does `fetch` → blob → object-URL download, or a plain anchor download).
- Both buttons call the same action; "Download then Start Packet" must not build twice — cache the `{ storageId, url }` result in component state and invalidate it whenever any form field changes.

### `invoices.ts` — `suggestInvoiceNumber` query (new)

Suggests the next number for the Invoice Number field default.

```ts
export const suggestInvoiceNumber = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const year = new Date().getFullYear();
    const clients = await ctx.db.query("clients").take(1000);
    const seq = clients.filter((c) => c.invoiceNumber.startsWith(`INV-${year}-`)).length + 1;
    return `INV-${year}-${String(seq).padStart(3, "0")}`;
  },
});
```

Purely a convenience default — the field stays editable and uniqueness is not enforced (invoice numbers are free strings on `clients` today).

### No schema changes

The builder is stateless: its output is a PDF blob plus a client-side handoff. Persistent invoice drafts are explicitly out of scope (see Out of Scope).

---

## Handoff: "Start Packet" → `/new-packet`

The wizard currently has phases `upload → extracting → verify → generating → complete`. A builder handoff skips the first two.

### Mechanism

`sessionStorage` key `sah:invoice-draft`, written by the builder right before `router.push("/new-packet")`:

```ts
type InvoiceDraft = {
  invoiceStorageId: Id<"_storage">;
  data: VerifiedData;          // exact shape from verify-step.tsx
};
```

`sessionStorage` (not query params) because the payload includes the full line-item array, and (not a Convex table) because the draft is meaningless outside the immediate navigation. It is removed as soon as the wizard consumes it, so refreshing `/new-packet` later starts a normal upload flow.

### `new-packet/page.tsx` changes

1. On mount, read and clear `sah:invoice-draft`. If present:
   - `setInvoiceStorageId(draft.invoiceStorageId)`
   - `setExtracted({ ...draft.data, totalMismatchWarning: false })`
   - `setPhase("draw-count")`
2. New lightweight phase `"draw-count"` rendered between upload and verify for drafts only — the one input the builder doesn't collect:

```
┌──────────────────────────────────────────────┐
│   Invoice ready: INV-2026-014 · John Doe     │
│   $44,800.00 · 6 line items                  │
│                                              │
│   Draw Count                                 │
│   [ Select draw count...          ▾ ]        │
│                                              │
│              [ Continue → Verify ]           │
└──────────────────────────────────────────────┘
```

   Extract the existing draw-count `<select>` from `upload-step.tsx` into a small shared component so both steps render identical controls.
3. After selection → `setPhase("verify")`. From there the existing Verify → Generate → Complete flow runs untouched (verify still gives a final review with editable fields, which also keeps the existing `canGenerate` validation as the last gate).
4. `StepIndicator`: for draft sessions, the first two steps display as pre-completed (the indicator already derives from a `stepIndex`; map `draw-count` to index 1).

---

## Frontend Component Changes

### `apps/web/src/app/(app)/invoice-builder/page.tsx` (new)

Client component. State mirrors the builder cards; reuses `EditableLineItem`-style string state (`qty`/`unitPrice` as strings, computed amounts) from `verify-step.tsx`.

```ts
const settings = useQuery(api.settings.getSettings);
const suggestedNumber = useQuery(api.invoices.suggestInvoiceNumber);
const buildInvoice = useAction(api.invoices.buildInvoice);
```

### `apps/web/src/components/invoice/line-items-editor.tsx` (new)

The drag-and-drop line item table:

- `Reorder.Group axis="y" values={rows} onReorder={setRows}` wrapping `Reorder.Item` rows.
- Rows keyed by a stable generated `id` (e.g. `crypto.randomUUID()` at row creation) — **not** array index, or drag reordering breaks React state.
- Drag handle (`GripVerticalIcon` from `lucide-react`) wired to `useDragControls`; `dragListener={false}` on the item so inputs remain fully interactive.
- Subtle elevation + scale on the dragged row (consistent with the app's motion language).
- Props: `{ rows, onChange }` — a controlled component so the page owns all state.

Consider also adopting it inside `verify-step.tsx` later to replace the arrow buttons (out of scope for the first cut, but design the props so nothing blocks that).

### `apps/web/src/components/wizard/draw-count-select.tsx` (extracted)

The `4 | 5 | 6` select pulled out of `upload-step.tsx`, used by both `UploadStep` and the new draw-count phase.

### Shared types

`VerifiedData` / `VerifiedLineItem` are currently exported from `verify-step.tsx` — the builder imports them from there (or they move to a small `apps/web/src/lib/types.ts` if the import direction feels wrong).

---

## Edge Cases & Constraints

| Case | Behavior |
|------|----------|
| Settings not configured | Form replaced by empty state linking to `/settings`; `buildInvoice` also throws server-side |
| Qty/price of `0` or blank | Coerced via `parseFloat(x) \|\| 0`, identical to verify step; rows with empty description **and** zero amount are dropped on submit (same filter as `handleGenerate`) |
| More than 10 line items | Amber soft warning; invoice PDF renders all rows (multi-page), contract templates itemize only the first 10 |
| Draw feasibility (e.g. every draw must be < $40,000, holdback rules) | **Not** validated in the builder — `buildDrawSchedule` already throws descriptive errors during packet generation, and draw count isn't known yet. The builder shows the 20% holdback figure for awareness only |
| User downloads, edits a field, downloads again | Cached `{ storageId, url }` invalidated on any form change; a fresh PDF is built |
| User downloads but never starts a packet | The orphaned blob in `_storage` is accepted (same situation as an uploaded invoice for an abandoned wizard session today) |
| Draft present but user refreshes mid-wizard | Draft was cleared on consumption; refresh lands on the normal upload step — acceptable, matches existing wizard behavior of restarting on refresh |
| Long descriptions | Wrapped in the PDF via `wrapLines`; table row grows |
| State field | Free-text 2-letter input like the rest of the app — no dropdown of states (consistency with verify step) |

---

## Out of Scope (explicitly)

- **Persistent invoice drafts** (an `invoiceDrafts` table with save/resume). The builder session is ephemeral; the durable artifacts are the PDF and, after packet generation, the `clients` row.
- Editing/regenerating an invoice for an **existing** client.
- Tax, discounts, deposits, or payment terms — SAH invoices are flat line-item totals with the 20% holdback handled by the draw schedule.
- Replacing the arrow-button reordering in `verify-step.tsx` with drag and drop (follow-up).

---

## Implementation Order

1. `lib/invoicePdf.ts` — pdf-lib layout module (pure function, easiest to verify in isolation).
2. `invoices.buildInvoice` action + `invoices.suggestInvoiceNumber` query.
3. Extract `draw-count-select.tsx` from `upload-step.tsx`.
4. `line-items-editor.tsx` with `motion/react` Reorder.
5. `/invoice-builder` page: cards, validation, Download flow.
6. Handoff: write draft + `new-packet` draft consumption + `draw-count` phase.
7. Nav item in `header.tsx`.
8. End-to-end pass: build invoice → download → start packet → verify pre-filled → generate → confirm `Invoice.pdf` sits just before the Payment Schedule in the merged packet and in the client file drawer.
