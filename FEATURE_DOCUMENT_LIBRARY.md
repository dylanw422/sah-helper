# Feature: Document Library (Contracts, Waivers, Spec Sheets)

## Overview

The Settings → PDF Templates tab is reorganized into three sections: **Contracts**, **Waivers**, and **Spec Sheets**.

- **Contracts** keeps the existing 7 fixed template slots (construction-contract / payment-schedule draw variants + va-addendum) exactly as they work today, and additionally lets the user upload *arbitrary new contract documents*. Custom contracts are AI field-mapped on upload (same `templateMapping` flow as the fixed slots) and are **always included in every generated packet**, filled with packet data, placed right after the fixed construction contract.
- **Waivers** and **Spec Sheets** are open-ended lists of *immutable* PDFs — no AcroForm fields, no mapping, never filled. They are merged into packets verbatim.

On the **Verify Data** wizard step, two new cards appear under Job Summary: **Waivers** and **Spec Sheets**, each listing a checkbox per uploaded file in that category. Checkboxes default to **unchecked**; checked files are appended to the generated packet.

Final packet merge order:

```
Construction Contract → [Custom Contracts…] → VA Addendum → Scope of Work
→ Invoice → [Checked Waivers…] → [Checked Spec Sheets…] → Payment Schedule
```

The payment schedule remains **always last** (existing invariant in `lib/templateKeys.ts` DOC_ORDER comment holds).

---

## UX Design

### Settings → PDF Templates tab (`apps/web/src/app/(app)/settings/templates-tab.tsx`)

```
┌─ Contracts ──────────────────────────────────────────────────────┐
│  Template                      Status              Actions       │
│  construction-contract-4draw   Mapped 12 fields    [↑][🔍]       │
│  ... (existing 7 fixed slots, unchanged) ...                     │
│  ────────────────────────────────────────────────────────────── │
│  lead-paint-disclosure.pdf     Mapped 4 fields     [🔍][🗑]      │
│                                          [ ↑ Add Contract ]      │
└──────────────────────────────────────────────────────────────────┘

┌─ Waivers ────────────────────────────────────────────────────────┐
│  File                          Uploaded            Actions       │
│  lien-waiver.pdf               Jun 12, 2026        [👁][🗑]      │
│                                          [ ↑ Add Waiver ]        │
│  (empty state: "No waivers uploaded yet.")                       │
└──────────────────────────────────────────────────────────────────┘

┌─ Spec Sheets ────────────────────────────────────────────────────┐
│  (same layout as Waivers)                [ ↑ Add Spec Sheet ]    │
└──────────────────────────────────────────────────────────────────┘
```

- Each section is a bordered table with a small section heading, replacing today's single flat table. The 7 fixed slots render first inside **Contracts** with their current Upload/Replace + Inspect behavior, untouched.
- **Add Contract / Add Waiver / Add Spec Sheet**: outline button below each table → file picker (`accept="application/pdf,.pdf"`) → upload → register. The document's display name is the uploaded filename (extension stripped).
- Custom contract rows show the same mapping status badges as fixed slots (`Mapping fields…` amber → `Mapped N fields` green) and an **Inspect** button feeding the existing Enumerated Fields panel.
- Waiver / spec sheet rows show only filename + upload date, a **View** action (opens the stored PDF via `ctx.storage.getUrl` in a new tab), and **Delete**. No status badge — there is nothing to map.
- **Delete** (all custom docs, including custom contracts): trash icon button with a `confirm()` (or AlertDialog, matching whatever the codebase already uses for destructive actions). Fixed slots cannot be deleted, only replaced — unchanged.
- Reuse the single hidden `<input type="file">` + `pendingRef` pattern already in the component; the ref now carries `{ kind: "slot", key } | { kind: "custom", category }`.

### Verify Data step (`apps/web/src/components/wizard/verify-step.tsx`)

Two new cards inserted between the **Job Summary** card and the **Line Items** card:

```
┌─ Waivers ──────────────────────────────┐
│  Include these documents in the packet │
│  ☐ Lien Waiver                         │
│  ☐ Warranty Waiver                     │
└────────────────────────────────────────┘
┌─ Spec Sheets ──────────────────────────┐
│  ☐ Window Spec Sheet                   │
└────────────────────────────────────────┘
```

- One checkbox + label per uploaded document in the category, in `uploadedAt` order. Use the shadcn `Checkbox` from `@sah-helper/ui` with a clickable `<Label>`.
- All checkboxes default unchecked. Checking adds that document to the packet.
- If a category has zero uploads, its card is **not rendered** (no empty card noise).
- No mention of custom contracts here — those are always included and not user-selectable per packet.

---

## Schema

New `customDocuments` table in `packages/backend/convex/schema.ts` (the existing `pdfTemplates` table is left untouched for the 7 fixed slots):

```ts
customDocuments: defineTable({
  category: v.union(v.literal("contract"), v.literal("waiver"), v.literal("spec-sheet")),
  displayName: v.string(),          // uploaded filename minus ".pdf"
  storageId: v.id("_storage"),
  uploadedAt: v.number(),
  // Only present for category "contract". PDF AcroForm field name →
  // PacketData key, AI-generated on upload (same as pdfTemplates.fieldMap).
  // Absent while mapping is in flight; {} if the PDF has no fields.
  fieldMap: v.optional(v.record(v.string(), v.string())),
}).index("by_category", ["category"]),
```

Why a separate table instead of extending `pdfTemplates`: fixed slots are identity-by-key with exactly-one-per-key semantics (replace-in-place); custom documents are an open-ended list with display names and deletion. Mixing them would complicate `listTemplates`, `registerTemplate`'s key validation, and the packet's missing-template check for no benefit.

---

## Backend API

### `packages/backend/convex/customDocuments.ts` (new file)

- **`listCustomDocuments` query** — `args: { category: v.optional(...) }`. `requireAuth`, query `by_category` (or full `.take(100)` when no filter), ordered by `uploadedAt` ascending. Returns docs including `fieldMap` so the settings tab can show mapping status.
- **`registerCustomDocument` mutation** — `args: { category, displayName, storageId }`. `requireAuth`, insert row; if `category === "contract"`, schedule field mapping:
  ```ts
  await ctx.scheduler.runAfter(0, internal.templateMapping.mapCustomDocumentFields, { id });
  ```
- **`deleteCustomDocument` mutation** — `args: { id: v.id("customDocuments") }`. `requireAuth`, `ctx.storage.delete(doc.storageId)`, `ctx.db.delete(id)`. Safe with respect to existing packets because packet generation stores per-packet copies (see below).
- **`getCustomDocumentUrl` query** — for the View action; mirrors `templates.getTemplateUrl`.
- **`inspectCustomDocument` action** — mirrors `templates.inspectTemplate` but loads by id; used by the custom-contract Inspect button.
- **`saveCustomFieldMap` internalMutation** — patches `fieldMap` on a `customDocuments` row (counterpart of `templates.saveFieldMap`).

Upload URLs reuse the existing `api.templates.generateTemplateUploadUrl` — it's a generic `ctx.storage.generateUploadUrl()` with auth, nothing template-specific.

### `packages/backend/convex/templateMapping.ts`

Extract the core of `mapTemplateFields` (download blob → `enumerateFields` → Claude prompt → field map) into a helper that takes `(ctx, storageId)` and returns the map. Then:

- `mapTemplateFields` (existing) — unchanged signature; calls the helper, saves via `templates.saveFieldMap`.
- **`mapCustomDocumentFields` internalAction (new)** — `args: { id: v.id("customDocuments") }`; calls the helper, saves via `customDocuments.saveCustomFieldMap`, and returns the map (so packet generation can use the on-demand fallback, same as fixed slots). If `enumerateFields` returns zero fields, save `{}` — the contract is then merged unfilled rather than erroring.

### `packages/backend/convex/packets.ts` — `generatePacket`

New args:

```ts
waiverIds: v.array(v.id("customDocuments")),
specSheetIds: v.array(v.id("customDocuments")),
```

Assembly changes (all inside the existing `docs` array construction, preserving the splice-before-last invariant for the payment schedule):

1. **Custom contracts** — after pushing the filled `construction-contract` doc (i.e., immediately after the `docName === "construction-contract"` iteration), load every `customDocuments` row with `category === "contract"` (via a new internal query), and for each: resolve `fieldMap` (on-demand `mapCustomDocumentFields` fallback if absent, mirroring lines 124–128), `fillTemplate` with the same `packetData`, push `{ filename: doc.displayName + ".pdf", doc }`. The cleanest implementation: build the docs list from DOC_ORDER as today, then splice the filled custom contracts in at index 1.
2. **Waivers / spec sheets** — after the invoice splice, fetch the rows for `args.waiverIds` then `args.specSheetIds` (validate each id resolves; throw `"Selected document no longer exists: …"` if not — covers a doc deleted in Settings mid-wizard). Load each blob, `PDFDocument.load` it unmodified, and splice the group in **just before the final payment-schedule entry**, waivers first, then spec sheets, preserving the checkbox/upload order within each group.
3. **`clientFiles`** — no special-casing: the existing loop (lines 182–197) already saves a fresh storage blob for any doc without a `storageId`, so waivers/spec sheets/custom contracts each get a **per-packet copy**. Do *not* set `storageId` to the library blob for waivers/spec sheets — the per-packet copy is what keeps `regeneratePacket` and the file drawer working after a library document is deleted.

`regeneratePacket` needs no changes — it merges whatever `clientFiles` rows exist in order.

### `lib/templateKeys.ts` / `lib/templateNames.ts`

No changes to `DOC_ORDER` or `TEMPLATE_KEYS` — custom documents are spliced in by `packets.ts`, not modeled as DOC_ORDER entries. Update the DOC_ORDER comment to mention the splice points for custom contracts, the invoice, and selected waivers/spec sheets.

---

## Frontend Changes

### `apps/web/src/app/(app)/settings/templates-tab.tsx`

1. Add `useQuery(api.customDocuments.listCustomDocuments)` and split results by category.
2. Restructure render into three labeled sections. Section 1 (Contracts) = the existing fixed-slot table rows + custom-contract rows + "Add Contract". Sections 2–3 = waiver / spec-sheet tables with View + Delete and their Add buttons.
3. `handleUploadCustom(category, file)`: upload URL → POST file → `registerCustomDocument({ category, displayName: file.name.replace(/\.pdf$/i, ""), storageId })` → success toast.
4. Custom-contract Inspect calls `inspectCustomDocument` and feeds the existing Enumerated Fields panel (key the `fields` state by `custom:<id>` to avoid colliding with fixed-slot keys; the "Fills With" column looks up the custom doc's `fieldMap`).
5. Delete: confirm → `deleteCustomDocument({ id })` → toast.

### `apps/web/src/components/wizard/verify-step.tsx`

1. `useQuery(api.customDocuments.listCustomDocuments)` (the component is already a client component); derive `waivers` and `specSheets` arrays.
2. New state: `selectedWaivers: Set<Id<"customDocuments">>`, `selectedSpecSheets: Set<...>` — both empty initially.
3. Render the two cards (conditionally, only when the category has uploads) between Job Summary and Line Items.
4. Extend `VerifiedData` with `waiverIds: Id<"customDocuments">[]` and `specSheetIds: Id<"customDocuments">[]`; `handleGenerate` includes the selected ids (in the order the documents are listed, not click order).

### `apps/web/src/app/(app)/new-packet/page.tsx`

Pass `waiverIds` / `specSheetIds` from the verified data through to the `generatePacket` action call. (If the invoice-builder "Start Packet" flow constructs `VerifiedData` via `toVerifiedData()`, default both to `[]` there — the user still picks them on the Verify step.)

---

## Edge Cases & Constraints

| Case | Behavior |
|------|----------|
| Custom contract uploaded, mapping still in flight at packet time | On-demand `mapCustomDocumentFields` fallback, same pattern as fixed slots (packets.ts:124–128) |
| Custom contract PDF has zero AcroForm fields | `fieldMap` saved as `{}`; document is merged as-is (effectively immutable) — no error |
| Waiver/spec sheet deleted in Settings while a wizard is open | `generatePacket` validates ids and throws a clear error; user unchecks and retries |
| Library document deleted after packets were generated | Existing packets unaffected — `clientFiles` hold per-packet storage copies |
| Zero waivers and zero spec sheets uploaded | Verify Data shows neither card; packet output identical to today |
| Non-PDF upload attempt | File picker filters to PDF; backend stores whatever arrives (same trust level as the existing template upload) |
| Duplicate display names | Allowed; rows are keyed by `_id` |
| Draw-count variants for custom contracts | None — custom contracts are draw-independent, one file each |
| Existing `pdfTemplates` data | Untouched; no migration needed (`customDocuments` is a new table) |

---

## Out of Scope (explicitly)

- Renaming custom documents after upload (re-upload instead).
- Reordering custom contracts / waivers / spec sheets within their groups (upload order is the order).
- Per-packet selection of custom contracts (they are always included by design).
- Remembering checkbox selections across packets.
- Filling waivers/spec sheets — they are immutable by definition.

---

## Implementation Order

1. Schema: `customDocuments` table + `by_category` index; codegen.
2. `customDocuments.ts`: list/register/delete/getUrl/inspect + `saveCustomFieldMap`.
3. `templateMapping.ts`: extract shared helper; add `mapCustomDocumentFields`.
4. `packets.ts`: new args, custom-contract splice after the construction contract, waiver/spec-sheet splice before the payment schedule, id validation.
5. Settings tab: three sections, custom uploads, View/Delete, Inspect for custom contracts.
6. Verify step: checkbox cards + `VerifiedData` extension; thread ids through `new-packet/page.tsx` (and default `[]` in the invoice-builder start-packet path).
7. Verify: upload one of each category → custom contract auto-maps → generate a packet with one waiver checked → merged PDF order is Contract → Custom Contract → Addendum → Scope of Work → Invoice → Waiver → Payment Schedule → file drawer lists all docs → delete the waiver from Settings → regenerate packet for that client still works.
