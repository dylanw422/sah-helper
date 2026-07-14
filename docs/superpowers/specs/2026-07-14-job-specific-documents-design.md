# Job-Specific Documents — design

## Purpose

Some client jobs need a document that isn't part of every packet — a doc that
only applies to specific jobs, not a standard waiver or spec sheet. Today the
Templates tab only has Contracts / Waivers / Spec Sheets, and the Verify Step
only lets the user pick from Waivers / Spec Sheets. This adds a third
selectable category, "Job-Specific Documents," following the exact same
pattern as Waivers and Spec Sheets.

## Scope

This is a reusable pool of uploaded PDFs (like Waivers), not documents bound
to one client/job record. The contractor uploads job-specific documents once
in the Templates tab, then checks the relevant ones per packet in the Verify
Step — same UX as Waivers/Spec Sheets today. No new binding of a document to
a specific client/job in the data model.

## Changes

### 1. Schema — `packages/backend/convex/schema.ts`

Add `"job-specific"` to the `category` union on the `customDocuments` table
(currently `v.union(v.literal("contract"), v.literal("waiver"), v.literal("spec-sheet"))`).

### 2. Backend validator — `packages/backend/convex/customDocuments.ts`

Add `"job-specific"` to the matching `categoryValidator` union (lines 9-13),
used by `registerCustomDocument` and related mutations.

### 3. Templates tab — `apps/web/src/app/(app)/settings/templates-tab.tsx`

- Extend `type Category` (line 24) to include `"job-specific"`.
- Add an entry to `ADD_LABELS` (line 27): `"job-specific": "Add Job-Specific Document"`.
- Add a filter: `const jobSpecificDocs = (customDocs ?? []).filter((d) => d.category === "job-specific");`
- Render a new section after Spec Sheets (after line 365):
  `{immutableSection("Job-Specific Documents", jobSpecificDocs, "job-specific")}`

This reuses the existing `immutableSection` helper and upload flow verbatim —
upload, rename/view, delete — no field mapping, matching how Waivers/Spec
Sheets work today (these are inserted into the packet as-is, not filled).

### 4. Verify Step — `apps/web/src/components/wizard/verify-step.tsx`

- Extend `VerifiedData` type (near line 45-46) with `jobSpecificIds?: Id<"customDocuments">[];`
- Add filter + selection state (near lines 96-100):
  ```tsx
  const jobSpecificDocs = (customDocs ?? []).filter((d) => d.category === "job-specific");
  const [selectedJobSpecific, setSelectedJobSpecific] = useState<Set<Id<"customDocuments">>>(new Set());
  ```
- Include in the payload built for `onGenerate` (near lines 150-151):
  `jobSpecificIds: jobSpecificDocs.filter((d) => selectedJobSpecific.has(d._id)).map((d) => d._id),`
- Render a new `DocumentSelectCard` after the Spec Sheets card (after line
  252), same conditional-render-if-nonempty pattern:
  ```tsx
  {jobSpecificDocs.length > 0 && (
    <DocumentSelectCard
      title="Job-Specific Documents"
      docs={jobSpecificDocs}
      selected={selectedJobSpecific}
      onChange={setSelectedJobSpecific}
    />
  )}
  ```

### 5. Packet generation — `packages/backend/convex/packets.ts`

- Add `jobSpecificIds: v.array(v.id("customDocuments"))` to the `generatePacket` action args (near line 42-43).
- Include the new ids in the merge loop (line 265):
  `for (const id of [...args.waiverIds, ...args.specSheetIds, ...args.jobSpecificIds])`
- Job-specific documents merge verbatim like waivers — do **not** set the
  `specSheet: true` flag for them (that flag exists specifically to trigger
  letter-size page normalization for spec sheets; job-specific docs should
  pass through unmodified, same as waivers do today via
  `specSheet: args.specSheetIds.includes(id)` evaluating false for them).

### 6. Wizard caller — `apps/web/src/app/(app)/new-packet/page.tsx`

- Pass `jobSpecificIds: data.jobSpecificIds ?? []` into the `generatePacket({...})` call (near lines 230-231), alongside the existing `waiverIds`/`specSheetIds`.

## Non-goals

- No per-client/per-job binding of documents in the data model.
- No AI field-mapping for job-specific documents (same as Waivers/Spec Sheets — inserted verbatim).
- No change to merge ordering beyond appending job-specific docs after spec sheets, before the payment schedule (mirrors existing waiver/spec-sheet placement).

## Testing

- Typecheck/build across `apps/web` and `packages/backend` (Convex codegen must pick up the new schema literal).
- Manual smoke test: upload a job-specific document in the Templates tab, generate a packet with it selected in Verify Step, confirm it appears in the merged PDF in the correct position and is not letter-size-normalized.
