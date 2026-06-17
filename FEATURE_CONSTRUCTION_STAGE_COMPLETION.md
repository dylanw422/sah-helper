# Feature: Construction Stage Completion Documents

## Problem

Each draw in a packet represents a claim against one stage of the project. There is currently no document in which the veteran acknowledges that the contractor has made a claim for a specific stage. We need a per-draw acknowledgement the veteran signs.

## Goal

Generate one **Construction Stage Completion** document per draw at packet-generation time. The document is built programmatically (no uploaded PDF template), the same way the Scope of Work is, and there is one copy per draw, the same way Lien Release produces one copy per draw.

## Document Contents

Each generated page contains, top to bottom:

1. **Title** (centered, bold): `Construction Stage Completion`
2. **Date line**: a label `Date:` followed by a blank ruled line for the veteran to write the date.
3. **Acknowledgement text**:

   > I acknowledge that {contractor name / company name} has made a claim for Stage {drawNumber} of my {totalDraws} stage project, per the signed disbursement schedule.

4. **Signature line** (near the bottom): a ruled line with the label `Veteran Signature` beneath it.

### Field values

- `{contractor name / company name}` — the combined contractor identity, formatted as `"{contractorName} / {contractorCompanyName}"` (e.g. `"William Gray / Access Innovations"`). This is the same combined form already used for the VA addendum's contractor line in `packets.ts`.
- `{drawNumber}` — the 1-based draw index (1 through `drawCount`).
- `{totalDraws}` — the packet's `drawCount` (4, 5, or 6).

The date and signature are intentionally left blank for the veteran to fill in by hand.

## Implementation Location

All PDF generation is server-side in Convex actions (`packages/backend/convex/`).

- **New builder**: `packages/backend/convex/lib/constructionStageCompletionPdf.ts`, exporting an async builder that returns a `PDFDocument`, modeled on `buildScopeOfWorkPdf` in `lib/scopeOfWorkPdf.ts`. Suggested signature:

  ```ts
  export async function buildConstructionStageCompletionPdf(input: {
    contractorName: string;   // already combined "Name / Company"
    drawNumber: number;
    totalDraws: number;
  }): Promise<PDFDocument>;
  ```

  It builds a single letter-size page (612×792) using `pdf-lib`, the same primitives (`PDFDocument.create`, `embedFont`, `drawText`, `drawLine`/`drawRectangle`) already used by the Scope of Work builder.

- **Wiring**: in `generatePacket` (`packages/backend/convex/packets.ts`), emit one entry per draw, filename `Construction Stage Completion (Draw {n}).pdf`, following the existing per-draw loop pattern used for lien releases:

  ```ts
  for (let drawIndex = 1; drawIndex <= drawCount; drawIndex++) {
    const doc = await buildConstructionStageCompletionPdf({
      contractorName: `${settings.contractorName} / ${settings.contractorCompanyName}`,
      drawNumber: drawIndex,
      totalDraws: drawCount,
    });
    entries.push({
      filename: `Construction Stage Completion (Draw ${drawIndex}).pdf`,
      storageId: await storeBytes(await doc.save()),
    });
  }
  ```

  Each generated doc is serialized and stored immediately (via the existing `storeBytes` helper) and only its `storageId` is kept in `entries`, preserving the one-document-at-a-time memory behavior described in `packets.ts`.

## Document Order

Add `construction-stage-completion` to the generated-doc machinery in `lib/templateKeys.ts`:

- Because it is built programmatically with no uploaded template, it belongs in `GENERATED_DOCS` (alongside `scope-of-work`), so it is excluded from the missing-template check.
- Insert it into `DOC_ORDER` at the agreed position. **Recommended placement: immediately before `lien-release`** so the per-stage acknowledgements sit next to the per-draw lien releases. The payment schedule must remain last.

Note: `scope-of-work` is currently the only `GENERATED_DOCS` entry and is handled with a single `if (GENERATED_DOCS.includes(docName))` branch that emits one document. The Construction Stage Completion is also generated but emits **one document per draw**. Handle it with its own branch (like the lien-release loop), not the single-doc Scope of Work branch.

## Scope

- Server-side only. No UI changes, no new settings, no uploaded template.
- Always generated for every packet (not optional), one per draw.
- Date and signature are left blank for handwriting.

## Acceptance Criteria

- [ ] A generated `Packet.pdf` contains exactly `drawCount` Construction Stage Completion pages (one per draw).
- [ ] Each page shows the title, a blank date line, the acknowledgement sentence, and a blank signature line labeled for the veteran.
- [ ] The acknowledgement sentence reads `...{contractorName} / {contractorCompanyName} has made a claim for Stage N of my {drawCount} stage project, per the signed disbursement schedule.` with N matching that page's draw number.
- [ ] The pages appear in the agreed `DOC_ORDER` position and the payment schedule is still last.
- [ ] Each generated document is registered with the file drawer (`addClientFile`) like every other packet entry, so it lists and re-merges on regeneration.
