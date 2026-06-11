import { PDFDocument } from "pdf-lib";

// Date fields are intentionally left blank — the client signs/dates by pen.
function isDateField(fieldName: string): boolean {
  return fieldName.toLowerCase().includes("date");
}


export async function fillTemplate(
  templateBytes: ArrayBuffer,
  fieldValues: Record<string, string>,
): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  for (const [fieldName, value] of Object.entries(fieldValues)) {
    if (isDateField(fieldName) || !value) continue;
    try {
      form.getTextField(fieldName).setText(value);
    } catch {
      // Field not present in this template — skip silently
    }
  }

  // Do NOT flatten — keep fields editable so dates can be pen-filled
  return pdfDoc;
}

export async function mergeDocuments(filledDocs: PDFDocument[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const doc of filledDocs) {
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
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
