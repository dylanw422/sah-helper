import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEXT_SIZE = 12;
const LINE_HEIGHT = 18;
const LINE_COLOR = rgb(0.2, 0.2, 0.2);

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildConstructionStageCompletionPdf(input: {
  contractorName: string;
  drawNumber: number;
  totalDraws: number;
}): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const title = "Construction Stage Completion";
  const titleSize = 18;
  page.drawText(title, {
    x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, titleSize)) / 2,
    y: y - titleSize,
    size: titleSize,
    font: bold,
  });
  y -= titleSize + 36;

  // Date line
  const dateLabel = "Date:";
  page.drawText(dateLabel, { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font: bold });
  const dateLineStart = MARGIN + bold.widthOfTextAtSize(dateLabel, TEXT_SIZE) + 8;
  page.drawLine({
    start: { x: dateLineStart, y: y - TEXT_SIZE },
    end: { x: MARGIN + CONTENT_WIDTH, y: y - TEXT_SIZE },
    thickness: 0.75,
    color: LINE_COLOR,
  });
  y -= 48;

  const acknowledgement = `I acknowledge that ${input.contractorName} has made a claim for Stage ${input.drawNumber} of my ${input.totalDraws} stage project, per the signed disbursement schedule.`;
  for (const line of wrapLines(font, acknowledgement, TEXT_SIZE, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font });
    y -= LINE_HEIGHT;
  }

  // Signature line near the bottom
  const sigY = MARGIN + 48;
  const sigLineWidth = CONTENT_WIDTH * 0.6;
  page.drawLine({
    start: { x: MARGIN, y: sigY },
    end: { x: MARGIN + sigLineWidth, y: sigY },
    thickness: 0.75,
    color: LINE_COLOR,
  });
  page.drawText("Veteran Signature", {
    x: MARGIN,
    y: sigY - 16,
    size: 10,
    font,
  });

  return doc;
}
