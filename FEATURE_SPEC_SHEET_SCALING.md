# Feature: Spec Sheet Page Normalization

## Problem

Uploaded spec sheet PDFs (VA 26-1852 or any contractor-supplied document) may have non-standard page dimensions (e.g., architectural D-size, tabloid, custom print sizes). When merged into the output `Packet.pdf`, these non-standard pages break the uniform page size of the document, causing rendering inconsistencies in PDF viewers and when printing.

## Goal

Every page in the final `Packet.pdf` must be standard letter size (8.5" × 11" / 612pt × 792pt). If a spec sheet page is a different size, it must be scaled to fit within letter dimensions while preserving its aspect ratio (no distortion).

## Behavior

- **Standard-size pages** (612pt × 792pt): merged as-is, no transformation.
- **Non-standard pages**: the page content is scaled down (never up) to fit within the letter page bounds, centered on a letter-size page with white margins. Aspect ratio is always preserved.
- Landscape non-standard pages are fit within a landscape-oriented letter page (11" × 8.5") — the wider of the two orientations is chosen to minimize margin waste.
- If a non-standard page is smaller than letter size, it is not scaled up — it is centered on the letter page as-is.

## Implementation Location

All PDF generation is server-side in Convex actions (`packages/backend/convex/`).

The merge step runs in `generatePacket` (or equivalent action). The normalization logic should be applied when embedding spec sheet pages into the merged output, not during upload.

## Implementation Approach

Use `pdf-lib` (already a dependency) to normalize spec sheet pages at merge time:

1. **Detect page size**: read `page.getSize()` from each spec sheet page.
2. **Compare to letter**: if width and height are both within 1pt of 612×792 (or 792×612 for landscape), treat as standard — embed directly.
3. **Scale to fit**: otherwise:
   - Determine target bounds: portrait letter (612×792) or landscape letter (792×612) — pick whichever orientation matches the spec sheet page orientation (width > height → landscape target).
   - Compute uniform scale factor: `Math.min(targetWidth / srcWidth, targetHeight / srcHeight)`.
   - Do not scale up: cap the scale factor at `1.0`.
   - Compute x/y offsets to center the scaled content on the target page.
   - Create a new letter-size page in the output PDF.
   - Embed the source page as an `XObject` (`embedPage`) and draw it with `drawPage` using the computed transform (x, y, xScale, yScale).

### Key pdf-lib APIs

```ts
const embeddedPage = outputPdf.embedPage(srcPage);
const { width: srcW, height: srcH } = srcPage.getSize();

const targetW = 612;
const targetH = 792;
const scale = Math.min(targetW / srcW, targetH / srcH, 1); // never scale up
const x = (targetW - srcW * scale) / 2;
const y = (targetH - srcH * scale) / 2;

const newPage = outputPdf.addPage([targetW, targetH]);
newPage.drawPage(embeddedPage, { x, y, xScale: scale, yScale: scale });
```

## Scope

- Applies only to spec sheet pages during the merge step.
- All other template pages (VA form PDFs) are already letter-size — no change to how those are handled.
- No UI changes required. No user-facing setting needed — normalization is always on.

## Acceptance Criteria

- [ ] Opening `Packet.pdf` in any PDF viewer shows all pages at the same size.
- [ ] A spec sheet that was originally tabloid (11"×17") is visibly reduced and centered on a letter page in the output.
- [ ] A spec sheet that was originally letter-size is unchanged in the output.
- [ ] Aspect ratio of spec sheet content is never distorted.
- [ ] No upscaling: a spec sheet smaller than letter is centered, not enlarged.
