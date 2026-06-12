import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 60;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.09, 0.1, 0.12);
const MUTED = rgb(0.45, 0.47, 0.5);
const HAIRLINE = rgb(0.85, 0.86, 0.88);

const TEXT_SIZE = 10;
const LABEL_SIZE = 7.5;
const LINE_HEIGHT = 14;

// Column layout: Description | Qty | Unit Price | Amount
const COL_QTY_WIDTH = 50;
const COL_UNIT_WIDTH = 90;
const COL_AMOUNT_WIDTH = 90;
const COL_DESC_WIDTH = TABLE_WIDTH - COL_QTY_WIDTH - COL_UNIT_WIDTH - COL_AMOUNT_WIDTH;
const COL_DESC_X = MARGIN;
const COL_QTY_RIGHT = MARGIN + COL_DESC_WIDTH + COL_QTY_WIDTH;
const COL_UNIT_RIGHT = COL_QTY_RIGHT + COL_UNIT_WIDTH;
const COL_AMOUNT_RIGHT = MARGIN + TABLE_WIDTH;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

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

export type InvoicePdfInput = {
  invoiceNumber: string;
  invoiceDate: string;
  caseNumber: string;
  client: {
    name: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  contractor: {
    contractorCompanyName: string;
    contractorName: string;
    contractorStreet: string;
    contractorCity: string;
    contractorState: string;
    contractorZip: string;
    contractorPhone: string;
    contractorEmail: string;
    contractorLicense: string;
  };
  lineItems: { description: string; qty: number; unitPrice: number; amount: number }[];
};

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<PDFDocument> {
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

  const drawRightAligned = (
    text: string,
    rightX: number,
    baselineY: number,
    f: PDFFont,
    size: number,
    color = INK,
  ) => {
    page.drawText(text, {
      x: rightX - f.widthOfTextAtSize(text, size),
      y: baselineY,
      size,
      font: f,
      color,
    });
  };

  const drawRule = (fromX: number, toX: number, atY: number, thickness: number, color = INK) => {
    page.drawLine({
      start: { x: fromX, y: atY },
      end: { x: toX, y: atY },
      thickness,
      color,
    });
  };

  // ── Header band: INVOICE + number/date ──
  const titleSize = 28;
  page.drawText("INVOICE", { x: MARGIN, y: y - titleSize, size: titleSize, font: bold, color: INK });

  const rightEdge = PAGE_WIDTH - MARGIN;
  const numberY = y - 12;
  const dateY = numberY - LINE_HEIGHT;
  const numberWidth = bold.widthOfTextAtSize(input.invoiceNumber, TEXT_SIZE);
  const dateWidth = font.widthOfTextAtSize(input.invoiceDate, TEXT_SIZE);
  drawRightAligned(input.invoiceNumber, rightEdge, numberY, bold, TEXT_SIZE, INK);
  drawRightAligned("NO.", rightEdge - numberWidth - 6, numberY, bold, LABEL_SIZE, MUTED);
  drawRightAligned(input.invoiceDate, rightEdge, dateY, font, TEXT_SIZE, INK);
  drawRightAligned("DATE", rightEdge - dateWidth - 6, dateY, bold, LABEL_SIZE, MUTED);
  y -= titleSize + 14;

  drawRule(MARGIN, rightEdge, y, 1, INK);
  y -= 28;

  // ── Parties: FROM / ISSUED TO columns ──
  const colRightX = MARGIN + TABLE_WIDTH / 2;
  const c = input.contractor;
  const fromLines = [
    c.contractorName,
    c.contractorLicense ? `License #${c.contractorLicense}` : "",
    c.contractorStreet,
    `${c.contractorCity}, ${c.contractorState} ${c.contractorZip}`,
    c.contractorPhone,
    c.contractorEmail,
  ].filter(Boolean);

  const cl = input.client;
  const issuedToLines = [cl.street, `${cl.city}, ${cl.state} ${cl.zip}`, cl.phone].filter(Boolean);

  page.drawText("FROM", { x: MARGIN, y: y - LABEL_SIZE, size: LABEL_SIZE, font: bold, color: MUTED });
  page.drawText("ISSUED TO", {
    x: colRightX,
    y: y - LABEL_SIZE,
    size: LABEL_SIZE,
    font: bold,
    color: MUTED,
  });
  y -= LABEL_SIZE + 10;

  const blockTop = y;
  page.drawText(c.contractorCompanyName, { x: MARGIN, y: y - 11, size: 11, font: bold, color: INK });
  y -= LINE_HEIGHT + 2;
  for (const line of fromLines) {
    page.drawText(line, { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font, color: MUTED });
    y -= LINE_HEIGHT;
  }

  let yRight = blockTop;
  page.drawText(cl.name, { x: colRightX, y: yRight - 11, size: 11, font: bold, color: INK });
  yRight -= LINE_HEIGHT + 2;
  for (const line of issuedToLines) {
    page.drawText(line, { x: colRightX, y: yRight - TEXT_SIZE, size: TEXT_SIZE, font, color: MUTED });
    yRight -= LINE_HEIGHT;
  }

  // Case number sits under the ISSUED TO block
  yRight -= 8;
  const caseLabel = "SAH CASE NUMBER";
  page.drawText(caseLabel, {
    x: colRightX,
    y: yRight - LABEL_SIZE,
    size: LABEL_SIZE,
    font: bold,
    color: MUTED,
  });
  page.drawText(input.caseNumber, {
    x: colRightX + bold.widthOfTextAtSize(caseLabel, LABEL_SIZE) + 8,
    y: yRight - TEXT_SIZE + 1,
    size: TEXT_SIZE,
    font: bold,
    color: INK,
  });
  yRight -= TEXT_SIZE;

  y = Math.min(y, yRight) - 24;

  // ── Line item table ──
  const headerHeight = LABEL_SIZE + 8;
  const drawTableHeader = () => {
    ensureSpace(headerHeight + LINE_HEIGHT + 10);
    page.drawText("DESCRIPTION", {
      x: COL_DESC_X,
      y: y - LABEL_SIZE,
      size: LABEL_SIZE,
      font: bold,
      color: MUTED,
    });
    drawRightAligned("QTY", COL_QTY_RIGHT, y - LABEL_SIZE, bold, LABEL_SIZE, MUTED);
    drawRightAligned("UNIT PRICE", COL_UNIT_RIGHT, y - LABEL_SIZE, bold, LABEL_SIZE, MUTED);
    drawRightAligned("AMOUNT", COL_AMOUNT_RIGHT, y - LABEL_SIZE, bold, LABEL_SIZE, MUTED);
    y -= headerHeight;
    drawRule(MARGIN, COL_AMOUNT_RIGHT, y, 0.5, HAIRLINE);
  };

  drawTableHeader();

  for (const item of input.lineItems) {
    const lines = wrapLines(font, item.description, TEXT_SIZE, COL_DESC_WIDTH - 12);
    const rowHeight = lines.length * LINE_HEIGHT + 10;
    if (y - rowHeight < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawTableHeader();
    }
    lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: COL_DESC_X,
        y: y - 17 - lineIndex * LINE_HEIGHT,
        size: TEXT_SIZE,
        font,
        color: INK,
      });
    });
    const valueY = y - 17;
    const isProfitRow = item.description === "Profit";
    if (isProfitRow) {
      drawRightAligned(`${item.qty}%`, COL_QTY_RIGHT, valueY, font, TEXT_SIZE, INK);
      // unit price column intentionally blank for profit row
    } else {
      drawRightAligned(String(item.qty), COL_QTY_RIGHT, valueY, font, TEXT_SIZE, INK);
      drawRightAligned(formatCurrency(item.unitPrice), COL_UNIT_RIGHT, valueY, font, TEXT_SIZE, INK);
    }
    drawRightAligned(formatCurrency(item.amount), COL_AMOUNT_RIGHT, valueY, font, TEXT_SIZE, INK);
    y -= rowHeight;
    drawRule(MARGIN, COL_AMOUNT_RIGHT, y, 0.5, HAIRLINE);
  }

  // ── Totals ──
  const total = input.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const totalsLeftX = COL_AMOUNT_RIGHT - (COL_UNIT_WIDTH + COL_AMOUNT_WIDTH);
  ensureSpace(24 + (LINE_HEIGHT + 10) + 12 + 16 + 14);
  y -= 24;
  page.drawText("Subtotal", { x: totalsLeftX, y: y - TEXT_SIZE, size: TEXT_SIZE, font, color: MUTED });
  drawRightAligned(formatCurrency(total), COL_AMOUNT_RIGHT, y - TEXT_SIZE, font, TEXT_SIZE, INK);
  y -= LINE_HEIGHT + 10;
  drawRule(totalsLeftX, COL_AMOUNT_RIGHT, y, 1, INK);
  y -= 12;
  page.drawText("TOTAL", { x: totalsLeftX, y: y - 16, size: 16, font: bold, color: INK });
  drawRightAligned(formatCurrency(total), COL_AMOUNT_RIGHT, y - 16, bold, 16, INK);

  return doc;
}
