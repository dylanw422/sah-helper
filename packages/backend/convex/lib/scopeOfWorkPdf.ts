import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

export const WORK_AREAS = [
  "Framing",
  "Electrical & Plumbing",
  "HVAC",
  "Insulation & Drywall",
  "Windows & Doors",
  "Flooring",
  "Finishes",
  "Roofing",
  "Other",
] as const;

export type WorkArea = (typeof WORK_AREAS)[number];

export type ScopeSection = {
  area: WorkArea;
  items: string[];
};

const SECTION_COLORS: Record<WorkArea, RGB> = {
  Framing: rgb(0.91, 0.84, 0.74),
  "Electrical & Plumbing": rgb(0.98, 0.94, 0.75),
  HVAC: rgb(0.8, 0.89, 0.97),
  "Insulation & Drywall": rgb(0.97, 0.85, 0.85),
  "Windows & Doors": rgb(0.82, 0.94, 0.94),
  Flooring: rgb(0.85, 0.94, 0.83),
  Finishes: rgb(0.9, 0.86, 0.96),
  Roofing: rgb(0.88, 0.88, 0.88),
  Other: rgb(0.99, 0.9, 0.79),
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BORDER = rgb(0.6, 0.6, 0.6);
const TEXT_SIZE = 10;
const LINE_HEIGHT = 13;
const SECTION_ROW_HEIGHT = 20;

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildScopeOfWorkPdf(input: {
  clientName: string;
  clientAddress: string;
  caseNumber: string;
  sections: ScopeSection[];
}): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (height: number) => {
    if (y - height < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const title = "Scope of Work";
  const titleSize = 18;
  page.drawText(title, {
    x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, titleSize)) / 2,
    y: y - titleSize,
    size: titleSize,
    font: bold,
  });
  y -= titleSize + 20;

  const infoRows: [string, string][] = [
    ["Veteran Name:", input.clientName],
    ["Address:", input.clientAddress],
    ["Case Number:", input.caseNumber || ""],
  ];
  for (const [label, value] of infoRows) {
    page.drawText(label, { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font: bold });
    page.drawText(value, { x: MARGIN + 88, y: y - TEXT_SIZE, size: TEXT_SIZE, font });
    y -= 16;
  }
  y -= 12;

  for (const section of input.sections) {
    if (section.items.length === 0) continue;

    // Keep the section header attached to at least its first item row
    ensureSpace(SECTION_ROW_HEIGHT + LINE_HEIGHT + 9);
    page.drawRectangle({
      x: MARGIN,
      y: y - SECTION_ROW_HEIGHT,
      width: TABLE_WIDTH,
      height: SECTION_ROW_HEIGHT,
      color: SECTION_COLORS[section.area],
      borderColor: BORDER,
      borderWidth: 0.5,
    });
    page.drawText(section.area, {
      x: MARGIN + 8,
      y: y - SECTION_ROW_HEIGHT + 6,
      size: 11,
      font: bold,
    });
    y -= SECTION_ROW_HEIGHT;

    section.items.forEach((item, index) => {
      const textX = MARGIN + 28;
      const lines = wrapLines(font, item, TEXT_SIZE, TABLE_WIDTH - 36);
      const rowHeight = lines.length * LINE_HEIGHT + 9;
      ensureSpace(rowHeight);
      page.drawRectangle({
        x: MARGIN,
        y: y - rowHeight,
        width: TABLE_WIDTH,
        height: rowHeight,
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      page.drawText(`${index + 1}.`, {
        x: MARGIN + 8,
        y: y - 16,
        size: TEXT_SIZE,
        font,
      });
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: textX,
          y: y - 16 - lineIndex * LINE_HEIGHT,
          size: TEXT_SIZE,
          font,
        });
      });
      y -= rowHeight;
    });
  }

  return doc;
}
