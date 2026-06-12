import { PDFDocument, StandardFonts } from "pdf-lib";

const TEXT_EXTENSIONS = ["txt", "md", "csv", "json", "log"];

export class UnsupportedFileError extends Error {
  constructor(filename: string) {
    super(`${filename} can't be converted to PDF.`);
  }
}

export async function convertToPdf(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let bytes: Uint8Array;

  if (file.type.startsWith("image/")) {
    bytes = await imageToPdf(file);
  } else if (file.type.startsWith("text/") || TEXT_EXTENSIONS.includes(extension)) {
    bytes = await textToPdf(await file.text());
  } else {
    throw new UnsupportedFileError(file.name);
  }

  const pdfName = file.name.replace(/\.[^.]+$/, "") + ".pdf";
  return new File([bytes as BlobPart], pdfName, { type: "application/pdf" });
}

async function imageToPdf(file: File): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  let image;
  if (file.type === "image/png") {
    image = await doc.embedPng(await file.arrayBuffer());
  } else if (file.type === "image/jpeg") {
    image = await doc.embedJpg(await file.arrayBuffer());
  } else {
    image = await doc.embedPng(await reencodeAsPng(file));
  }

  // Fit to US Letter with a margin, but never upscale
  const maxWidth = 612 - 72;
  const maxHeight = 792 - 72;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;

  const page = doc.addPage([612, 792]);
  page.drawImage(image, {
    x: (612 - width) / 2,
    y: (792 - height) / 2,
    width,
    height,
  });

  return doc.save();
}

async function reencodeAsPng(file: File): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UnsupportedFileError(file.name);
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UnsupportedFileError(file.name);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new UnsupportedFileError(file.name);
  return blob.arrayBuffer();
}

async function textToPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const fontSize = 10;
  const lineHeight = fontSize * 1.4;
  const margin = 54;
  const pageWidth = 612;
  const pageHeight = 792;
  const maxLineWidth = pageWidth - margin * 2;

  const encodable = new Set(font.getCharacterSet());
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    // Replace chars the standard font can't encode (tabs, emoji, etc.)
    const clean = [...paragraph]
      .map((ch) => (encodable.has(ch.codePointAt(0) ?? 0) ? ch : " "))
      .join("");
    if (clean.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of clean.split(" ")) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxLineWidth) {
        current = candidate;
      } else {
        if (current.length > 0) lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
  for (let i = 0; i < lines.length; i += linesPerPage) {
    const page = doc.addPage([pageWidth, pageHeight]);
    lines.slice(i, i + linesPerPage).forEach((line, j) => {
      if (line.length === 0) return;
      page.drawText(line, {
        x: margin,
        y: pageHeight - margin - lineHeight * (j + 1),
        size: fontSize,
        font,
      });
    });
  }

  return doc.save();
}
