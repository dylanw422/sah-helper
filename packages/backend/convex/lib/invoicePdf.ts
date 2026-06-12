import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const TABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BORDER = rgb(0.6, 0.6, 0.6);
const ZEBRA = rgb(0.955, 0.955, 0.965);
const TEXT_SIZE = 10;
const LINE_HEIGHT = 13;

// Column layout: Description | Qty | Unit Price | Amount
const COL_QTY_WIDTH = 50;
const COL_UNIT_WIDTH = 90;
const COL_AMOUNT_WIDTH = 90;
const COL_DESC_WIDTH = TABLE_WIDTH - COL_QTY_WIDTH - COL_UNIT_WIDTH - COL_AMOUNT_WIDTH;
const COL_DESC_X = MARGIN + 8;
const COL_QTY_RIGHT = MARGIN + COL_DESC_WIDTH + COL_QTY_WIDTH - 8;
const COL_UNIT_RIGHT = COL_QTY_RIGHT + COL_UNIT_WIDTH;
const COL_AMOUNT_RIGHT = MARGIN + TABLE_WIDTH - 8;

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

  const drawRightAligned = (text: string, rightX: number, baselineY: number, f: PDFFont, size: number) => {
    page.drawText(text, {
      x: rightX - f.widthOfTextAtSize(text, size),
      y: baselineY,
      size,
      font: f,
    });
  };

  const drawDivider = () => {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.75,
      color: BORDER,
    });
  };

  // ── Header: INVOICE + number/date ──
  const titleSize = 22;
  page.drawText("INVOICE", { x: MARGIN, y: y - titleSize, size: titleSize, font: bold });
  drawRightAligned(`Invoice #: ${input.invoiceNumber}`, PAGE_WIDTH - MARGIN, y - 12, bold, TEXT_SIZE);
  drawRightAligned(`Issue Date: ${input.invoiceDate}`, PAGE_WIDTH - MARGIN, y - 12 - LINE_HEIGHT, font, TEXT_SIZE);
  y -= titleSize + 16;

  drawDivider();
  y -= 18;

  // ── FROM / BILL TO columns ──
  const colRightX = MARGIN + TABLE_WIDTH / 2;
  const c = input.contractor;
  const fromLines = [
    c.contractorCompanyName,
    c.contractorName,
    c.contractorLicense ? `License #${c.contractorLicense}` : "",
    c.contractorStreet,
    `${c.contractorCity}, ${c.contractorState} ${c.contractorZip}`,
    `Phone: ${c.contractorPhone}`,
    c.contractorEmail,
  ].filter(Boolean);

  const cl = input.client;
  const billToLines = [
    `Name: ${cl.name}`,
    `Address: ${cl.street}`,
    `${cl.city}, ${cl.state}`,
    `Zip Code: ${cl.zip}`,
    `Phone: ${cl.phone}`,
  ];

  page.drawText("FROM", { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font: bold });
  page.drawText("ISSUED TO", { x: colRightX, y: y - TEXT_SIZE, size: TEXT_SIZE, font: bold });
  y -= 18;

  const blockTop = y;
  for (const line of fromLines) {
    page.drawText(line, { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font });
    y -= LINE_HEIGHT + 2;
  }
  let yRight = blockTop;
  for (const line of billToLines) {
    page.drawText(line, { x: colRightX, y: yRight - TEXT_SIZE, size: TEXT_SIZE, font });
    yRight -= LINE_HEIGHT + 2;
  }
  y = Math.min(y, yRight) - 6;

  page.drawText("SAH Case Number:", { x: MARGIN, y: y - TEXT_SIZE, size: TEXT_SIZE, font: bold });
  page.drawText(input.caseNumber, {
    x: MARGIN + bold.widthOfTextAtSize("SAH Case Number:", TEXT_SIZE) + 6,
    y: y - TEXT_SIZE,
    size: TEXT_SIZE,
    font,
  });
  y -= LINE_HEIGHT + 12;

  // ── Line item table ──
  const headerHeight = 22;
  const drawTableHeader = () => {
    ensureSpace(headerHeight + LINE_HEIGHT + 9);
    page.drawRectangle({
      x: MARGIN,
      y: y - headerHeight,
      width: TABLE_WIDTH,
      height: headerHeight,
      color: rgb(0.16, 0.18, 0.25),
    });
    const headerY = y - headerHeight + 7;
    const white = rgb(1, 1, 1);
    page.drawText("DESCRIPTION", { x: COL_DESC_X, y: headerY, size: 9, font: bold, color: white });
    const drawHeaderRight = (text: string, rightX: number) => {
      page.drawText(text, {
        x: rightX - bold.widthOfTextAtSize(text, 9),
        y: headerY,
        size: 9,
        font: bold,
        color: white,
      });
    };
    drawHeaderRight("QTY", COL_QTY_RIGHT);
    drawHeaderRight("UNIT PRICE", COL_UNIT_RIGHT);
    drawHeaderRight("AMOUNT", COL_AMOUNT_RIGHT);
    y -= headerHeight;
  };

  drawTableHeader();

  input.lineItems.forEach((item, index) => {
    const lines = wrapLines(font, item.description, TEXT_SIZE, COL_DESC_WIDTH - 16);
    const rowHeight = lines.length * LINE_HEIGHT + 9;
    if (y - rowHeight < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawTableHeader();
    }
    page.drawRectangle({
      x: MARGIN,
      y: y - rowHeight,
      width: TABLE_WIDTH,
      height: rowHeight,
      color: index % 2 === 1 ? ZEBRA : undefined,
      borderColor: BORDER,
      borderWidth: 0.5,
    });
    lines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: COL_DESC_X,
        y: y - 16 - lineIndex * LINE_HEIGHT,
        size: TEXT_SIZE,
        font,
      });
    });
    const valueY = y - 16;
    drawRightAligned(String(item.qty), COL_QTY_RIGHT, valueY, font, TEXT_SIZE);
    drawRightAligned(formatCurrency(item.unitPrice), COL_UNIT_RIGHT, valueY, font, TEXT_SIZE);
    drawRightAligned(formatCurrency(item.amount), COL_AMOUNT_RIGHT, valueY, font, TEXT_SIZE);
    y -= rowHeight;
  });

  // ── Totals ──
  const total = input.lineItems.reduce((sum, item) => sum + item.amount, 0);
  y -= 14;
  ensureSpace(LINE_HEIGHT * 2 + 10);
  const labelRightX = COL_UNIT_RIGHT;
  drawRightAligned("Subtotal:", labelRightX, y - TEXT_SIZE, font, TEXT_SIZE);
  drawRightAligned(formatCurrency(total), COL_AMOUNT_RIGHT, y - TEXT_SIZE, font, TEXT_SIZE);
  y -= LINE_HEIGHT + 4;
  drawRightAligned("Total:", labelRightX, y - 11, bold, 11);
  drawRightAligned(formatCurrency(total), COL_AMOUNT_RIGHT, y - 11, bold, 11);

  return doc;
}
