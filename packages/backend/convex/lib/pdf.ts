import { PDFDocument, StandardFonts, type PDFFont, type PDFTextField } from "pdf-lib";

// Date fields are intentionally left blank — the client signs/dates by pen.
function isDateField(fieldName: string): boolean {
  return fieldName.toLowerCase().includes("date");
}

const MAX_FONT_SIZE = 11;
const MIN_FONT_SIZE = 6;
const FIELD_PADDING = 4;
const LINE_HEIGHT_FACTOR = 1.2;

function fitFontSize(font: PDFFont, text: string, width: number, _height: number): number {
  let size = MAX_FONT_SIZE;
  const longestLineWidth = (s: number) =>
    Math.max(...text.split("\n").map((line) => font.widthOfTextAtSize(line, s)));
  while (size > MIN_FONT_SIZE && longestLineWidth(size) > width - FIELD_PADDING) {
    size -= 0.25;
  }
  return size;
}

function countWrappedLines(font: PDFFont, text: string, size: number, maxWidth: number): number {
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines++;
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines++;
        line = word;
      } else {
        line = candidate;
      }
    }
  }
  return lines;
}

function fitMultilineFontSize(font: PDFFont, text: string, width: number, height: number): number {
  for (let size = MAX_FONT_SIZE; size > MIN_FONT_SIZE; size -= 0.25) {
    const lines = countWrappedLines(font, text, size, width - FIELD_PADDING);
    if (lines * size * LINE_HEIGHT_FACTOR <= height - FIELD_PADDING) return size;
  }
  return MIN_FONT_SIZE;
}

export async function fillTemplate(
  templateBytes: ArrayBuffer,
  fieldValues: Record<string, string>,
  sizeGroups: string[][] = [],
): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fitted = new Map<string, { field: PDFTextField; size: number }>();

  for (const [fieldName, value] of Object.entries(fieldValues)) {
    if (isDateField(fieldName) || !value) continue;
    try {
      const field = form.getTextField(fieldName);
      field.setText(value);

      // Shrink the font so the value fits inside the field's box — template
      // defaults are often too large for the small amount boxes.
      const widget = field.acroField.getWidgets()[0];
      if (!widget) continue;
      const { width, height } = widget.getRectangle();
      const size = field.isMultiline()
        ? fitMultilineFontSize(font, value, width, height)
        : fitFontSize(font, value, width, height);
      fitted.set(fieldName, { field, size });
    } catch {
      // Not a text field — try checkbox
      try {
        const checkbox = form.getCheckBox(fieldName);
        if (value === "Yes") {
          checkbox.check();
        } else {
          checkbox.uncheck();
        }
      } catch {
        // Field not present in this template — skip silently
      }
    }
  }

  // Related fields (e.g. the draw description column) share one font size:
  // every member renders at the smallest size any member needed to fit.
  for (const group of sizeGroups) {
    const members = group.filter((name) => fitted.has(name));
    if (members.length < 2) continue;
    const minSize = Math.min(...members.map((name) => fitted.get(name)!.size));
    for (const name of members) {
      fitted.get(name)!.size = minSize;
    }
  }

  for (const { field, size } of fitted.values()) {
    // Fields without a /DA entry make setFontSize throw — seed one first.
    if (field.acroField.getDefaultAppearance() === undefined) {
      field.acroField.setDefaultAppearance("/Helv 0 Tf 0 g");
    }
    field.setFontSize(size);
  }
  form.updateFieldAppearances(font);

  // Do NOT flatten — keep fields editable so dates can be pen-filled
  return pdfDoc;
}

const LETTER_W = 612;
const LETTER_H = 792;
const LETTER_TOLERANCE = 1;

// Adds each page of srcDoc to merged, normalizing to letter size. Standard-size
// pages are copied verbatim. Non-standard pages are embedded once as a single
// reusable XObject and scaled to fit the page width; if the scaled content is
// still taller than one letter page, the SAME embedded XObject is drawn across
// multiple tile pages at different vertical offsets. Embedding once (rather than
// re-copying per tile) keeps the heavy image/font resources shared by reference.
async function addNormalizedSpecSheetPages(
  merged: PDFDocument,
  srcDoc: PDFDocument,
): Promise<void> {
  const srcPages = srcDoc.getPages();

  for (let i = 0; i < srcPages.length; i++) {
    const { width: srcW, height: srcH } = srcPages[i].getSize();

    const isPortraitLetter =
      Math.abs(srcW - LETTER_W) <= LETTER_TOLERANCE &&
      Math.abs(srcH - LETTER_H) <= LETTER_TOLERANCE;
    const isLandscapeLetter =
      Math.abs(srcW - LETTER_H) <= LETTER_TOLERANCE &&
      Math.abs(srcH - LETTER_W) <= LETTER_TOLERANCE;

    if (isPortraitLetter || isLandscapeLetter) {
      const [copied] = await merged.copyPages(srcDoc, [i]);
      merged.addPage(copied);
      continue;
    }

    const landscape = srcW > srcH;
    const targetW = landscape ? LETTER_H : LETTER_W;
    const targetH = landscape ? LETTER_W : LETTER_H;
    const scaleToFitWidth = Math.min(targetW / srcW, 1);
    const scaledH = srcH * scaleToFitWidth;
    const embedded = await merged.embedPage(srcPages[i]);

    if (scaledH > targetH) {
      const numTiles = Math.ceil(scaledH / targetH);
      const xOffset = (targetW - srcW * scaleToFitWidth) / 2;
      for (let t = 0; t < numTiles; t++) {
        // yOffset positions the embedded page so tile t's slice aligns with [0, targetH]
        const yOffset = (t + 1) * targetH - scaledH;
        const page = merged.addPage([targetW, targetH]);
        page.drawPage(embedded, {
          x: xOffset,
          y: yOffset,
          xScale: scaleToFitWidth,
          yScale: scaleToFitWidth,
        });
      }
    } else {
      const scale = Math.min(targetW / srcW, targetH / srcH, 1);
      const page = merged.addPage([targetW, targetH]);
      page.drawPage(embedded, {
        x: (targetW - srcW * scale) / 2,
        y: (targetH - srcH * scale) / 2,
        xScale: scale,
        yScale: scale,
      });
    }
  }
}

export async function mergeDocuments(filledDocs: PDFDocument[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const doc of filledDocs) {
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

// Merges an ordered list of documents one at a time. Each entry's bytes are
// fetched lazily via load() inside the loop so only a single source document is
// resident at once — the fetched bytes and the loaded PDFDocument both go out of
// scope each iteration and can be reclaimed before the next document is fetched.
// Spec sheet entries are normalized to letter size as they are added.
export async function mergeDocsIncrementally(
  docs: ReadonlyArray<{ load: () => Promise<ArrayBuffer>; specSheet?: boolean }>,
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const { load, specSheet } of docs) {
    const doc = await PDFDocument.load(await load());
    if (specSheet) {
      await addNormalizedSpecSheetPages(merged, doc);
    } else {
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }
  }
  return merged.save();
}

export async function mergePdfBytes(docs: ArrayBuffer[]): Promise<Uint8Array> {
  const loaded = await Promise.all(docs.map((bytes) => PDFDocument.load(bytes)));
  return mergeDocuments(loaded);
}

export async function enumerateFields(
  pdfBytes: ArrayBuffer,
): Promise<{ name: string; type: string }[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc
    .getForm()
    .getFields()
    .map((f) => ({ name: f.getName(), type: f.constructor.name }));
}
