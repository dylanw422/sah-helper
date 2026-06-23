# Feature: Pricing Catalog & AI Invoice Generation

## Overview

A learned **pricing catalog** that captures the line items and unit pricing from every
invoice (and every packet client) the contractor has produced, and an **AI invoice
generator** that turns a plain‑English description of a job into a populated set of line
items — reusing catalog items at their learned prices and creating new items with
sensible estimates when the work has never been quoted before.

The catalog grows automatically: there is no separate data‑entry step. Each time an
invoice is saved in the Invoice Builder, or a packet client is created, its line items are
ingested into the catalog. Over time the contractor accumulates an accurate, private price
book that powers one‑click invoice drafting.

Every generated (or hand‑built) invoice is checked against the **VA SAH maximum grant
amount of $126,526**. If the invoice total meets or exceeds the cap, the app warns the
user prominently and the AI generator is told to keep the work inside the budget and to
flag when the described scope cannot fit.

This builds directly on the existing **Invoice Builder** (`/invoice-builder`,
`FEATURE_INVOICE_BUILDER.md`) and **Saved Invoices** (`FEATURE_SAVED_INVOICES.md`)
features — generation produces the same `LineItemRow[]` the builder already edits, so the
download / save / Start Packet flow is unchanged.

---

## Goals

1. **Capture** every line item + price from saved invoices and packet clients, idempotently.
2. **Consolidate** repeated items so "Tile shower install" and "Install tile shower" roll up
   to one catalog entry with real price statistics (last / average / min / max).
3. **Generate** a draft invoice from a textual work description, reusing catalog pricing.
4. **Guard** the $126,526 grant ceiling everywhere a total is shown or generated.
5. **Stay editable** — the contractor can view and correct learned prices; corrections feed
   back into future generations.

---

## The Max Grant Constant

New shared module `packages/backend/convex/lib/grant.ts`:

```ts
// VA SAH (Specially Adapted Housing) maximum grant amount for FY2026.
// The grant pays the full contract total (line items + profit), so the cap is
// checked against the invoice *total*, profit included.
export const MAX_GRANT_AMOUNT = 126_526;
```

Re‑exported to the web app via a tiny `apps/web/src/lib/grant.ts` (or imported from the
backend package the same way `lineItemValidator` is) so the builder UI and the backend use
the **same** number. Never hard‑code `126526` in more than one place.

The check compares against the invoice **total** (regular subtotal + profit amount), since
that is the dollar figure the grant disburses. Three severity bands:

| Band | Condition | Treatment |
|------|-----------|-----------|
| OK | `total < MAX_GRANT_AMOUNT * 0.9` | no banner |
| Near | `0.9 * cap ≤ total < cap` | amber banner: "Approaching the $126,526 SAH grant maximum (currently $X)." |
| Over | `total ≥ cap` | red banner: "This invoice meets or exceeds the $126,526 SAH grant maximum by $Y. The VA grant will not cover the overage." Non‑blocking — the contractor may still build/save (jobs can exceed the grant with the veteran covering the difference), but the warning is unmissable. |

---

## Data Model

Two new Convex tables. The catalog is a **rolled‑up view** derived from raw
observations, so re‑saving the same invoice never double‑counts.

### `catalogItems` — one row per distinct piece of work/material

```ts
catalogItems: defineTable({
  // Human-facing canonical label, e.g. "Tile shower install".
  canonicalDescription: v.string(),
  // Deterministic match key: lowercased, trimmed, whitespace-collapsed,
  // punctuation-stripped canonicalDescription. Used for ingest dedup.
  matchKey: v.string(),
  // Optional construction area (reuses scope-of-work WORK_AREAS vocabulary).
  area: v.optional(v.string()),
  // Optional unit hint ("each", "sq ft", "linear ft", "lump sum"). Inferred by
  // AI when a new item is created during generation; unknown for ingest-only items.
  unit: v.optional(v.string()),
  // Price statistics, recomputed from priceObservations on every sync.
  lastUnitPrice: v.number(),
  avgUnitPrice: v.number(),
  minUnitPrice: v.number(),
  maxUnitPrice: v.number(),
  occurrences: v.number(),     // number of observations backing this item
  lastUsedAt: v.number(),      // newest observation's observedAt
  // True when a user manually edited the price in the catalog UI. Manual price
  // is preferred as the "representative" price for generation and is NOT
  // overwritten by stat recomputation (see Manual overrides).
  priceLocked: v.optional(v.boolean()),
  manualUnitPrice: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_matchKey", ["matchKey"])
  .index("by_lastUsedAt", ["lastUsedAt"]),
```

### `priceObservations` — one row per source line item

```ts
priceObservations: defineTable({
  catalogItemId: v.id("catalogItems"),
  // Where this observation came from, so a source can be re-synced idempotently.
  sourceType: v.union(v.literal("invoice"), v.literal("client")),
  sourceId: v.string(),        // invoices._id or clients._id, stringified
  description: v.string(),     // as written on that invoice (for audit)
  qty: v.number(),
  unitPrice: v.number(),
  observedAt: v.number(),      // source invoiceDate or createdAt
})
  .index("by_source", ["sourceType", "sourceId"])
  .index("by_catalogItem", ["catalogItemId"]),
```

**Why two tables:** the Invoice Builder auto‑saves on every field blur, so the same invoice
is written many times. Deriving `catalogItems` stats from `priceObservations` and keying
observations by `sourceId` makes ingestion idempotent — re‑syncing a source replaces its
observations rather than appending. Without this, occurrence counts and averages would
inflate on every keystroke‑triggered autosave.

No changes to existing tables.

---

## Ingestion (learning from invoices)

A single internal helper drives all ingestion. New file
`packages/backend/convex/catalog.ts` (a normal — non‑node — module; ingestion is pure DB
work, no AI):

```ts
// Idempotent: deletes prior observations for this source, then re-inserts from
// the current line items and recomputes stats for every affected catalogItem.
export async function syncSource(
  ctx: MutationCtx,
  args: {
    sourceType: "invoice" | "client";
    sourceId: string;
    observedAt: number;
    lineItems: { description: string; qty: number; unitPrice: number }[];
  },
): Promise<void>
```

Algorithm:

1. **Exclude non‑catalog rows.** Drop the profit row (`description === "Profit"`,
   case‑insensitive — matches `PROFIT_DESCRIPTION`) and rows with a blank description.
   Profit is a percentage handled by the builder, never a catalog item.
2. **Collect prior observations** for `(sourceType, sourceId)` via `by_source`; remember
   their `catalogItemId`s as the "touched" set, then delete them.
3. For each remaining line item:
   - Compute `matchKey` from the description.
   - `findOrCreate` a `catalogItem` by `matchKey` (via `by_matchKey`). On create, seed
     `canonicalDescription` with the original (nicely‑cased) description and `area` left
     empty.
   - Insert a `priceObservation` and add the item to the touched set.
4. **Recompute stats** for every catalogItem in the touched set from its current
   observations (`by_catalogItem`):
   - `occurrences = count`; if zero (item lost its last observation) → **delete the
     catalogItem** unless `priceLocked` (a user‑curated entry survives with `occurrences:
     0`).
   - `avg/min/max` over `unitPrice`; `lastUnitPrice` and `lastUsedAt` from the newest
     `observedAt`.
   - Do **not** touch `manualUnitPrice` / `priceLocked`.

### Hook points

- **`invoiceBuilder.saveInvoice`** (mutation) — after the insert/patch, call
  `syncSource(ctx, { sourceType: "invoice", sourceId: id, observedAt: <invoiceDate→ms or now>, lineItems })`.
  Same transaction; deterministic; cheap.
- **Packet client creation** in `clients.ts` (the `db.insert("clients", …)` path around
  line 108) — call `syncSource` with `sourceType: "client"`. This captures AI‑extracted
  invoices that never went through the builder. Use the client's `lineItems`,
  `sourceId = clientId`, `observedAt = createdAt`.
- **Deletion** — when an invoice is deleted (`invoiceBuilder.deleteInvoice`) call a
  `syncSource(...lineItems: [])` for that source to retract its observations and let stats
  recompute (or delete now‑empty items). Same for client deletion if such a path exists.

### Backfill

One‑time internal action `catalog.backfillFromExisting` (run from the Convex dashboard or
a Settings "Rebuild catalog" button):

- Truncate `priceObservations` and `catalogItems` (or only the non‑`priceLocked` items).
- Page through all `invoices` and all `clients`, calling `syncSource` for each.

Idempotent by construction, so it can be re‑run safely after the feature ships.

---

## AI Invoice Generation

New **node** action (Anthropic SDK, same pattern as `scopeOfWork.ts`):
`packages/backend/convex/invoiceGenerator.ts`.

```ts
export const generateLineItems = action({
  args: {
    description: v.string(),   // the contractor's plain-English job description
  },
  handler: async (ctx, { description }): Promise<GenerateResult> => { … },
});

type GeneratedItem = {
  description: string;
  qty: number;
  unitPrice: number;
  catalogItemId: string | null;  // set when AI reused a catalog entry
  isEstimate: boolean;           // true when no catalog match → AI guessed the price
};

type GenerateResult = {
  items: GeneratedItem[];
  total: number;                 // sum of qty*unitPrice (excludes profit)
  exceedsGrant: boolean;         // total >= MAX_GRANT_AMOUNT
  notes: string[];               // e.g. "Tile work priced from 1 prior invoice",
                                 //      "No prior pricing for ADA ramp — estimated"
};
```

Flow:

1. **Load the catalog.** Query `catalogItems` ordered by `by_lastUsedAt` (cap at ~300 most
   recently used to bound the prompt). For each pass the AI: `id`, `canonicalDescription`,
   `unit`, a single **representative unit price** (`manualUnitPrice` when `priceLocked`,
   else `lastUnitPrice`), and `occurrences` (so the AI can weight confidence).
2. **Prompt.** System prompt mirrors `scopeOfWork.ts` tone ("construction estimator for VA
   SAH grant packets… return ONLY valid JSON"). User prompt provides:
   - the job description,
   - the catalog as a numbered list with id + representative price,
   - the rules below.
3. **Rules baked into the prompt:**
   - Break the described work into concrete line items in **construction order** (demo →
     rough‑in → finish), since downstream draws split in line‑item order.
   - Write descriptions specific to THIS job — do NOT copy catalog descriptions verbatim.
     Line items will rarely be identical across jobs; the catalog is a **pricing reference**,
     not a copy-paste library.
   - **Reference** a catalog item (return its `catalogItemId`) when similar work appears in
     the catalog; use that price as the basis for the unit price. `isEstimate: false`.
   - **Create** a new item (`catalogItemId: null`, `isEstimate: true`) when no catalog item
     is relevant; estimate a realistic unit price using national residential construction norms.
   - Do **not** add a profit line — the builder owns the profit percentage.
   - **Budget:** the VA SAH grant maximum is **$126,526**. Keep the total at or under the
     cap. If the described scope cannot reasonably fit, still return the best itemization
     but add a `notes` entry explaining the overage rather than silently trimming work.
   - Return ONLY JSON: `{ "items": [...], "notes": [...] }`.
4. **Parse + validate** with a `tryParse` helper like `tryParseSections` (find first `{` /
   last `}`, `JSON.parse`, shape‑check, one retry on failure, then throw a clear error).
   Coerce numbers, drop malformed items, recompute `total` server‑side (never trust the
   model's arithmetic), and set `exceedsGrant` from `MAX_GRANT_AMOUNT`.
5. Return `GenerateResult`. The action does **not** write to the catalog — generation is
   read‑only against learned prices; the catalog only grows when the resulting invoice is
   actually saved (which flows through `syncSource`).

Model: `claude-sonnet-4-6` (consistent with `scopeOfWork.ts`), `max_tokens: 4096`.

---

## UI

### 1. "Generate with AI" in the Invoice Builder

Add a card at the top of the builder's left column (above "From (Contractor)") —
collapsed by default to a single button row so it doesn't clutter manual entry:

```
┌─ Generate with AI ─────────────────────────────────────────────┐
│  Describe the job and we'll draft line items from your pricing.│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ e.g. "Convert hall bath to a roll-in ADA shower: demo,     ││
│  │ widen the doorway to 36", new plumbing, tile, grab bars,   ││
│  │ comfort-height toilet, and a new vanity."                  ││
│  └────────────────────────────────────────────────────────────┘│
│                                     [ ✨ Generate Line Items ] │
└────────────────────────────────────────────────────────────────┘
```

Behavior:

- Calls `useAction(api.invoiceGenerator.generateLineItems)` with the textarea content.
- On success, maps `GeneratedItem[]` → `LineItemRow[]` (`createLineItemRow` shape: string
  `qty`/`unitPrice`, fresh `crypto.randomUUID()` id) and **replaces** the current regular
  rows, preserving the existing profit row. If the builder already has user‑entered rows,
  confirm via the existing `ConfirmDialog` before replacing ("Replace current line
  items?"). Mark the form dirty (`markChanged`) so the cached build invalidates and
  autosave fires.
- Items reused from the catalog render normally; **estimated** items (`isEstimate`) get a
  small amber "estimated" chip in the line‑items editor row and the `notes` surface as a
  dismissible info banner above the table. (Per the quiet‑UI preference, this is a settled
  result banner, not a live status indicator.)
- Loading: button shows a spinner + "Generating…"; errors via `toast.error` (matches the
  existing builder error handling). No streaming/progress chrome.

### 2. Grant‑limit banner in the builder

In the **Invoice Summary** card (and mirrored at the top of the AI result), compute the
band from `total` vs `MAX_GRANT_AMOUNT` and render the amber/red banner described in *The
Max Grant Constant*. Always visible whenever `Near`/`Over`, regardless of how the line
items were entered (manual or AI). Add a `Grant max` row to the summary `<dl>`:

```
Subtotal      $112,400.00
Profit (20%)   $22,480.00
Total         $134,880.00
Grant max     $126,526.00
Over by        $8,354.00   ← red
```

### 3. Pricing Catalog page — `/catalog`

A browsable, editable view of learned prices. New nav item in `header.tsx` after "Invoice
Builder" (or nested under Settings — the contractor's call; default to a top‑level item).

```
┌─ Pricing Catalog ──────────────────────────────────────────────────────┐
│  Learned from 42 invoices · 137 items          [ 🔍 Search items… ]    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Item                         Unit    Avg price   Last    Used  ⋯ │  │
│  │ Tile shower install          sq ft    $94.50    $95.00    12   ✎ │  │
│  │ Comfort-height toilet        each    $420.00   $410.00     9   ✎ │  │
│  │ Demo existing bathroom       lump     $4,375    $4,500      8   ✎ │  │
│  │ ADA grab bar (set of 3)      set      $185.00   $185.00     3   ✎ │  │
│  │ …                                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

- Powered by `useQuery(api.catalog.listItems)` — ordered by `lastUsedAt` desc, client‑side
  search filter on `canonicalDescription`.
- Per‑row edit (pencil): a small dialog to fix the **canonical description**, set/clear a
  **manual price** (sets `priceLocked` + `manualUnitPrice`), set the **unit**, or **delete**
  the item. Manual price is what generation uses as the representative price, so this is the
  contractor's lever to correct bad AI estimates permanently.
- Show `occurrences` and the price range (`min`–`max`) as a tooltip so the contractor can
  judge confidence.
- Empty state when no invoices exist yet: "Your pricing catalog fills in automatically as
  you save invoices. Build your first invoice to get started." with a link to
  `/invoice-builder`.

---

## Backend API summary

`packages/backend/convex/catalog.ts` (non‑node):

| Export | Kind | Purpose |
|--------|------|---------|
| `syncSource` | helper (not a Convex fn) | idempotent ingest, called inline from mutations |
| `listItems` | query | catalog table for the `/catalog` page |
| `updateItem` | mutation | edit canonical description / unit / manual price / lock |
| `deleteItem` | mutation | remove a catalog item and its observations |
| `backfillFromExisting` | internalAction (or mutation) | one‑time / on‑demand rebuild |

`packages/backend/convex/invoiceGenerator.ts` (node):

| Export | Kind | Purpose |
|--------|------|---------|
| `generateLineItems` | action | AI: description → `GenerateResult` |

`packages/backend/convex/lib/grant.ts`: `MAX_GRANT_AMOUNT` constant + a
`grantBand(total)` helper returning `"ok" | "near" | "over"` shared by UI and server.

Wiring into existing files:

- `invoiceBuilder.saveInvoice` → call `syncSource` after insert/patch.
- `invoiceBuilder.deleteInvoice` → `syncSource` with empty line items.
- `clients.ts` client insert path → `syncSource` (sourceType `"client"`).
- `schema.ts` → add `catalogItems` + `priceObservations` tables.

No changes to the packet generation pipeline, PDF layout, or the Start Packet handoff.

---

## Edge Cases & Constraints

| Case | Behavior |
|------|----------|
| Autosave re‑saves the same invoice repeatedly | `syncSource` is idempotent per `sourceId`; stats never inflate |
| Same work, different wording across invoices | `matchKey` normalization rolls obvious variants together; AI also matches semantically at generation time even when `matchKey` differs |
| Profit row | Always excluded from the catalog; never generated by the AI; builder owns the percentage |
| Non‑construction items (plans, permits, overhead) | Still ingested as catalog items (they recur and have prices), but the AI generator is told to itemize only physical work from the description — it won't invent permit/overhead lines unless the description asks |
| AI estimates a price for brand‑new work | Item returned with `isEstimate: true` + amber chip + a `notes` entry; contractor can correct it, and once saved it joins the catalog at the corrected price |
| Generated/manual total ≥ $126,526 | Red over‑budget banner; non‑blocking (veteran may cover overage) |
| Empty / nonsense AI description | Action returns `{ items: [], notes: ["Could not derive line items from the description."] }`; builder shows the note, leaves existing rows untouched |
| Catalog item loses all observations (source edited/deleted) | Auto‑deleted on recompute, unless `priceLocked` (user‑curated survives) |
| Manual price set, then new observations arrive | Stats (`avg/min/max/last`) still update for display, but generation keeps using `manualUnitPrice` while `priceLocked` |
| Very large catalog | Generation prompt caps at ~300 most‑recently‑used items to bound tokens; `/catalog` page `take(1000)` with client‑side search |
| Currency/number formatting | Reuse `formatCurrency` / `Intl.NumberFormat` already used across the app |

---

## Out of Scope (explicitly)

- **Quantity/area takeoff** from the description (e.g. computing exact tile sq ft from
  room dimensions) — the AI estimates quantities, the contractor confirms.
- **Regional cost indexing** or external pricing APIs — the catalog is purely the
  contractor's own history.
- **Multi‑user price separation** — all users share one catalog (consistent with the
  app's "all users equal" model).
- **Editing the grant maximum in‑app** — `MAX_GRANT_AMOUNT` is a code constant; bump it in
  one place when the VA changes the figure.
- **Re‑pricing existing saved invoices** when catalog prices change — generation affects
  new drafts only.
- **Streaming the AI generation** — single request/response with a spinner, matching the
  quiet‑UI preference.

---

## Implementation Order

1. `lib/grant.ts` — `MAX_GRANT_AMOUNT` + `grantBand` (pure, trivially testable).
2. `schema.ts` — add `catalogItems` + `priceObservations` tables.
3. `catalog.ts` — `syncSource` helper + stat recompute; `listItems` / `updateItem` /
   `deleteItem`; `backfillFromExisting`.
4. Wire `syncSource` into `invoiceBuilder.saveInvoice` / `deleteInvoice` and the
   `clients.ts` insert path. Run `backfillFromExisting` once.
5. `invoiceGenerator.ts` — `generateLineItems` node action + parse/validate/retry.
6. Builder UI: grant‑limit banner + summary `Grant max` row (no AI yet — verifies the cap
   math end‑to‑end).
7. Builder UI: "Generate with AI" card → rows mapping → estimate chips + notes banner.
8. `/catalog` page + nav item: list, search, edit dialog, empty state.
9. End‑to‑end pass: save a few invoices → confirm catalog fills → generate from a
   description → confirm reuse vs. estimate behavior, grant banner at >$126,526, and that
   the generated draft downloads / saves / starts a packet unchanged.
```

