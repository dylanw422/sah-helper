import { renderToStaticMarkup } from "react-dom/server";
import { PlanArtwork } from "./plan-artwork";
import { printBounds, printLayout, type PdfScale } from "@/lib/floor-plan/print";
import { detectRooms } from "@/lib/floor-plan/geometry";
import type { Layers, Plan } from "@/lib/floor-plan/model";

export function downloadFile(content: Blob, filename: string) {
  const url = URL.createObjectURL(content), link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function safeFilename(name: string) { return name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "floor-plan"; }
export function planSvg(plan: Plan, layers: Layers, pixels?: { width: number; height: number }) {
  const box = printBounds(plan, layers);
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={pixels?.width ?? box.width * 2} height={pixels?.height ?? box.height * 2} preserveAspectRatio={pixels ? "none" : undefined} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}><title>{plan.name}</title><rect x={box.x} y={box.y} width={box.width} height={box.height} fill="#fff" /><PlanArtwork theme="monochrome" plan={plan} layers={{ ...layers, grid: false }} prefix="export" /></svg>);
  return { svg, box };
}
export async function exportPdf(plan: Plan, layers: Layers, scale: PdfScale) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const box = printBounds(plan, layers);
  const canvas = document.createElement("canvas");
  const resolution = Math.min(3, 8192 / Math.max(box.width, box.height));
  canvas.width = Math.ceil(box.width * resolution); canvas.height = Math.ceil(box.height * resolution);
  // Map the viewBox exactly to the integer raster size. The PDF restores the
  // world aspect ratio, avoiding scale drift from rounded image dimensions.
  const { svg } = planSvg(plan, layers, canvas);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("Could not render the plan for export.")); img.src = url; });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser does not support image export.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not create the plan image.")), "image/png"));
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(await png.arrayBuffer());
    const layout = printLayout(box, scale);
    const page = pdf.addPage([layout.width, layout.height]);
    page.drawRectangle({ x: 0, y: 0, width: layout.width, height: layout.height, color: rgb(1, 1, 1) });
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pdfText = (value: string) => value.replace(/[^\x20-\x7E]/g, " ");
    page.drawImage(image, { x: layout.x, y: layout.y, width: layout.drawingWidth, height: layout.drawingHeight });
    let title = pdfText(plan.name);
    if (bold.widthOfTextAtSize(title, 16) > layout.width - 72) {
      while (title.length && bold.widthOfTextAtSize(`${title}...`, 16) > layout.width - 72) title = title.slice(0, -1);
    }
    if (title !== pdfText(plan.name)) title += "...";
    page.drawText(title, { x: 36, y: layout.height - 35, size: 16, font: bold, color: rgb(0, 0, 0) });
    page.drawText(`SAH HELPER  /  FLOOR PLAN     Scale: ${layout.scaleLabel}     ${layout.name} ${layout.orientation}`, { x: 36, y: layout.height - 52, size: 9, font });
    const totalArea = detectRooms(plan.walls).reduce((sum, room) => sum + room.area, 0);
    page.drawText(`Total usable floor area: ${totalArea.toLocaleString("en-US", { maximumFractionDigits: 0 })} sq ft`, { x: 36, y: layout.height - 65, size: 9, font: bold });
    page.drawText("Print at 100% / Actual size. Disable scaling in the print dialog to preserve the scale above.", { x: 36, y: 28, size: 8, font });
    page.drawText("Exterior totals measure outside faces; smaller dimensions measure clear space between walls.", { x: 36, y: 16, size: 8, font });
    pdf.setTitle(pdfText(plan.name));
    pdf.setSubject(`Floor plan / Scale ${layout.scaleLabel} / ${layout.name} ${layout.orientation} / Print at 100%`);
    const bytes = await pdf.save();
    downloadFile(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), `${safeFilename(plan.name)}.pdf`);
  } finally { URL.revokeObjectURL(url); }
}
