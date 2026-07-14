# Job-Specific Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third selectable document category, "Job-Specific Documents," alongside the existing Waivers and Spec Sheets — uploadable in the Templates tab, selectable per-packet in the Verify Step, merged verbatim into the generated packet.

**Architecture:** This is a straight extension of the existing `customDocuments` category pattern (`"contract" | "waiver" | "spec-sheet"` → add `"job-specific"`). No new tables, no new components — every touch point mirrors how Waivers already work end to end: schema literal → backend validator → Templates tab section → Verify Step selection card → `generatePacket` merge args → wizard call site.

**Tech Stack:** Next.js 19 (App Router), Convex, TypeScript, Tailwind v4 + shadcn/ui.

## Global Constraints

- No test framework exists in this repo (confirmed: no `*.test.ts(x)`, no vitest/jest config). Verification is via typecheck + build, not unit tests.
- Verify Convex backend changes with: `npx tsc -p packages/backend/convex/tsconfig.json --noEmit` (run from repo root).
- Verify frontend/workspace-wide changes with: `bun run check-types` and `bun run build` (run from repo root; these are turbo tasks that fan out to packages defining them).
- Job-specific documents must NOT get the `specSheet: true` merge flag — that flag exists solely to trigger letter-size page normalization for spec sheets. Job-specific docs pass through unmodified, same as waivers today.
- Follow the exact category string `"job-specific"` (matches existing kebab-case convention of `"spec-sheet"`).

---

### Task 1: Add `"job-specific"` category to schema and backend validator

**Files:**
- Modify: `packages/backend/convex/schema.ts:98`
- Modify: `packages/backend/convex/customDocuments.ts:9-13`

**Interfaces:**
- Produces: `customDocuments.category` now accepts `"job-specific"` as a valid Convex value, and `categoryValidator` in `customDocuments.ts` accepts it for `listCustomDocuments` / `registerCustomDocument` args.

- [ ] **Step 1: Update the schema union**

In `packages/backend/convex/schema.ts`, change line 98:

```ts
category: v.union(v.literal("contract"), v.literal("waiver"), v.literal("spec-sheet")),
```

to:

```ts
category: v.union(
  v.literal("contract"),
  v.literal("waiver"),
  v.literal("spec-sheet"),
  v.literal("job-specific"),
),
```

- [ ] **Step 2: Update the backend validator**

In `packages/backend/convex/customDocuments.ts`, change lines 9-13:

```ts
const categoryValidator = v.union(
  v.literal("contract"),
  v.literal("waiver"),
  v.literal("spec-sheet"),
);
```

to:

```ts
const categoryValidator = v.union(
  v.literal("contract"),
  v.literal("waiver"),
  v.literal("spec-sheet"),
  v.literal("job-specific"),
);
```

- [ ] **Step 3: Typecheck the backend**

Run: `npx tsc -p packages/backend/convex/tsconfig.json --noEmit`
Expected: no errors (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/customDocuments.ts
git commit -m "Add job-specific category to customDocuments schema"
```

---

### Task 2: Add Job-Specific Documents section to the Templates tab

**Files:**
- Modify: `apps/web/src/app/(app)/settings/templates-tab.tsx:24,27-31,51-53,364-365`

**Interfaces:**
- Consumes: `Doc<"customDocuments">` with `category` now including `"job-specific"` (Task 1). Existing `immutableSection(title, docs, category)` helper (defined at line 210) and `addButton(category)` helper (line 187) — both already generic over `Category`, no changes needed to their bodies.
- Produces: A new "Job-Specific Documents" section rendered in the same location/style as Waivers and Spec Sheets, using the same upload/view/delete flow.

- [ ] **Step 1: Extend the `Category` type**

In `apps/web/src/app/(app)/settings/templates-tab.tsx`, change line 24:

```ts
type Category = "contract" | "waiver" | "spec-sheet";
```

to:

```ts
type Category = "contract" | "waiver" | "spec-sheet" | "job-specific";
```

- [ ] **Step 2: Add the upload button label**

Change lines 27-31:

```ts
const ADD_LABELS: Record<Category, string> = {
  contract: "Add Contract",
  waiver: "Add Waiver",
  "spec-sheet": "Add Spec Sheet",
};
```

to:

```ts
const ADD_LABELS: Record<Category, string> = {
  contract: "Add Contract",
  waiver: "Add Waiver",
  "spec-sheet": "Add Spec Sheet",
  "job-specific": "Add Job-Specific Document",
};
```

- [ ] **Step 3: Add the filtered list**

Change lines 51-53:

```ts
const customContracts = (customDocs ?? []).filter((d) => d.category === "contract");
const waivers = (customDocs ?? []).filter((d) => d.category === "waiver");
const specSheets = (customDocs ?? []).filter((d) => d.category === "spec-sheet");
```

to:

```ts
const customContracts = (customDocs ?? []).filter((d) => d.category === "contract");
const waivers = (customDocs ?? []).filter((d) => d.category === "waiver");
const specSheets = (customDocs ?? []).filter((d) => d.category === "spec-sheet");
const jobSpecificDocs = (customDocs ?? []).filter((d) => d.category === "job-specific");
```

- [ ] **Step 4: Render the new section**

Change lines 364-365:

```tsx
{immutableSection("Waivers", waivers, "waiver")}
{immutableSection("Spec Sheets", specSheets, "spec-sheet")}
```

to:

```tsx
{immutableSection("Waivers", waivers, "waiver")}
{immutableSection("Spec Sheets", specSheets, "spec-sheet")}
{immutableSection("Job-Specific Documents", jobSpecificDocs, "job-specific")}
```

- [ ] **Step 5: Typecheck and build**

Run: `bun run check-types && bun run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/settings/templates-tab.tsx
git commit -m "Add Job-Specific Documents section to Templates tab"
```

---

### Task 3: Add Job-Specific Documents selection to the Verify Step

**Files:**
- Modify: `apps/web/src/components/wizard/verify-step.tsx:45-46,96-102,150-151,236-252`

**Interfaces:**
- Consumes: `Category` now includes `"job-specific"` (Task 1); existing `DocumentSelectCard` component (defined later in the same file) — already generic, no changes needed to its body.
- Produces: `VerifiedData.jobSpecificIds?: Id<"customDocuments">[]`, populated by `handleGenerate` from the new checkbox selection, consumed by Task 5 (wizard call site).

- [ ] **Step 1: Extend the `VerifiedData` type**

Change lines 45-46 (inside the `VerifiedData` type):

```ts
  waiverIds?: Id<"customDocuments">[];
  specSheetIds?: Id<"customDocuments">[];
```

to:

```ts
  waiverIds?: Id<"customDocuments">[];
  specSheetIds?: Id<"customDocuments">[];
  jobSpecificIds?: Id<"customDocuments">[];
```

- [ ] **Step 2: Add filtered list and selection state**

Change lines 96-102:

```ts
  const customDocs = useQuery(api.customDocuments.listCustomDocuments, {});
  const waivers = (customDocs ?? []).filter((d) => d.category === "waiver");
  const specSheets = (customDocs ?? []).filter((d) => d.category === "spec-sheet");
  const [selectedWaivers, setSelectedWaivers] = useState<Set<Id<"customDocuments">>>(new Set());
  const [selectedSpecSheets, setSelectedSpecSheets] = useState<Set<Id<"customDocuments">>>(
    new Set(),
  );
```

to:

```ts
  const customDocs = useQuery(api.customDocuments.listCustomDocuments, {});
  const waivers = (customDocs ?? []).filter((d) => d.category === "waiver");
  const specSheets = (customDocs ?? []).filter((d) => d.category === "spec-sheet");
  const jobSpecificDocs = (customDocs ?? []).filter((d) => d.category === "job-specific");
  const [selectedWaivers, setSelectedWaivers] = useState<Set<Id<"customDocuments">>>(new Set());
  const [selectedSpecSheets, setSelectedSpecSheets] = useState<Set<Id<"customDocuments">>>(
    new Set(),
  );
  const [selectedJobSpecific, setSelectedJobSpecific] = useState<Set<Id<"customDocuments">>>(
    new Set(),
  );
```

- [ ] **Step 3: Include selection in `handleGenerate` payload**

Change lines 150-151:

```ts
      waiverIds: waivers.filter((d) => selectedWaivers.has(d._id)).map((d) => d._id),
      specSheetIds: specSheets.filter((d) => selectedSpecSheets.has(d._id)).map((d) => d._id),
```

to:

```ts
      waiverIds: waivers.filter((d) => selectedWaivers.has(d._id)).map((d) => d._id),
      specSheetIds: specSheets.filter((d) => selectedSpecSheets.has(d._id)).map((d) => d._id),
      jobSpecificIds: jobSpecificDocs
        .filter((d) => selectedJobSpecific.has(d._id))
        .map((d) => d._id),
```

- [ ] **Step 4: Render the new `DocumentSelectCard`**

Change lines 236-252:

```tsx
        {waivers.length > 0 && (
          <DocumentSelectCard
            title="Waivers"
            docs={waivers}
            selected={selectedWaivers}
            onChange={setSelectedWaivers}
          />
        )}

        {specSheets.length > 0 && (
          <DocumentSelectCard
            title="Spec Sheets"
            docs={specSheets}
            selected={selectedSpecSheets}
            onChange={setSelectedSpecSheets}
          />
        )}
```

to:

```tsx
        {waivers.length > 0 && (
          <DocumentSelectCard
            title="Waivers"
            docs={waivers}
            selected={selectedWaivers}
            onChange={setSelectedWaivers}
          />
        )}

        {specSheets.length > 0 && (
          <DocumentSelectCard
            title="Spec Sheets"
            docs={specSheets}
            selected={selectedSpecSheets}
            onChange={setSelectedSpecSheets}
          />
        )}

        {jobSpecificDocs.length > 0 && (
          <DocumentSelectCard
            title="Job-Specific Documents"
            docs={jobSpecificDocs}
            selected={selectedJobSpecific}
            onChange={setSelectedJobSpecific}
          />
        )}
```

- [ ] **Step 5: Typecheck and build**

Run: `bun run check-types && bun run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/wizard/verify-step.tsx
git commit -m "Add Job-Specific Documents selection to Verify Step"
```

---

### Task 4: Merge selected job-specific documents into the generated packet

**Files:**
- Modify: `packages/backend/convex/packets.ts:42-43,265`

**Interfaces:**
- Consumes: `Id<"customDocuments">` array from `apps/web/src/app/(app)/new-packet/page.tsx` (wired in Task 5).
- Produces: `generatePacket` action now accepts `jobSpecificIds` and merges those documents into the packet after spec sheets, before the payment schedule — verbatim (no `specSheet` normalization flag).

- [ ] **Step 1: Add `jobSpecificIds` to the action args**

In `packages/backend/convex/packets.ts`, change lines 42-43:

```ts
    waiverIds: v.array(v.id("customDocuments")),
    specSheetIds: v.array(v.id("customDocuments")),
```

to:

```ts
    waiverIds: v.array(v.id("customDocuments")),
    specSheetIds: v.array(v.id("customDocuments")),
    jobSpecificIds: v.array(v.id("customDocuments")),
```

- [ ] **Step 2: Include job-specific ids in the merge loop**

Change line 265:

```ts
    for (const id of [...args.waiverIds, ...args.specSheetIds]) {
```

to:

```ts
    for (const id of [...args.waiverIds, ...args.specSheetIds, ...args.jobSpecificIds]) {
```

Leave the rest of the loop body (lines 266-277) unchanged — `specSheet: args.specSheetIds.includes(id)` already correctly evaluates to `false` for job-specific document ids, so no letter-size normalization is applied to them, matching how waivers are handled today.

- [ ] **Step 3: Typecheck the backend**

Run: `npx tsc -p packages/backend/convex/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/packets.ts
git commit -m "Merge selected job-specific documents into generated packets"
```

---

### Task 5: Wire the wizard call site to pass `jobSpecificIds`

**Files:**
- Modify: `apps/web/src/app/(app)/new-packet/page.tsx:230-231`

**Interfaces:**
- Consumes: `VerifiedData.jobSpecificIds` (Task 3), `generatePacket` args including `jobSpecificIds` (Task 4).
- Produces: End-to-end wiring complete — the Verify Step's checkbox selection now reaches the backend merge.

- [ ] **Step 1: Pass `jobSpecificIds` into the `generatePacket` call**

In `apps/web/src/app/(app)/new-packet/page.tsx`, change lines 230-231:

```ts
          waiverIds: data.waiverIds ?? [],
          specSheetIds: data.specSheetIds ?? [],
```

to:

```ts
          waiverIds: data.waiverIds ?? [],
          specSheetIds: data.specSheetIds ?? [],
          jobSpecificIds: data.jobSpecificIds ?? [],
```

- [ ] **Step 2: Full workspace typecheck and build**

Run: `bun run check-types && bun run build`
Expected: no errors. This is the final integration point — a clean build here confirms all five tasks compose correctly (schema → validator → Templates tab → Verify Step → packet generation → wizard call site).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/new-packet/page.tsx
git commit -m "Pass jobSpecificIds through to packet generation"
```

- [ ] **Step 4: Manual smoke test**

Start the dev server (`bun run dev` or `bun run dev:web` + `bun run dev:server`), then:
1. Go to Settings → Templates tab, confirm "Job-Specific Documents" section appears below Spec Sheets, upload a test PDF.
2. Start a new packet, reach the Verify Step, confirm a "Job-Specific Documents" card appears with the uploaded doc checked/unchecked, check it.
3. Generate the packet, download the merged PDF, confirm the job-specific document appears in the output (after spec sheets, before the payment schedule) and is not resized to letter format if it was a different page size.

---

## Self-Review Notes

- **Spec coverage:** All 6 numbered changes from the design spec (schema, backend validator, Templates tab, Verify Step, packet generation, wizard caller) map to Tasks 1-5 above. Non-goals (no per-client binding, no AI field-mapping) require no code — confirmed by omission.
- **Type consistency:** `jobSpecificIds: Id<"customDocuments">[]` used identically across `VerifiedData` (Task 3), `generatePacket` args (Task 4), and the call site (Task 5). Category string `"job-specific"` used identically in schema, validator, `Category` type, and all filter predicates.
- **No placeholders:** every step shows exact before/after code.
