import { automaticDimensions } from "./dimensions";
import { displayedDimensionLayout } from "./dimension-layout";
import { bounds, distance, planBounds, roofPolygons } from "./geometry";
import type { Layers, Plan } from "./model";

export type PdfScale = "fit-a4" | 0.25 | 0.125 | 0.0625;
export const A4 = { width: 210 * 72 / 25.4, height: 297 * 72 / 25.4 };

// Model coordinates are real inches. Include the visible roof and dimension
// extensions so fitting the house also fits its annotations.
export function printBounds(plan: Plan, layers: Layers) {
  const b = planBounds({ ...plan, fixtures: layers.fixtures ? plan.fixtures : [], utilities: layers.utilities ? plan.utilities : [], notes: layers.notes ? plan.notes : [] });
  const points = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }];
  if (layers.roof) points.push(...roofPolygons(plan).flat());
  if (layers.dimensions) for (const { dimension: dim } of displayedDimensionLayout(automaticDimensions(plan))) {
    const length = distance(dim.a, dim.b);
    if (!length) continue;
    const nx = -(dim.b.y - dim.a.y) / length, ny = (dim.b.x - dim.a.x) / length;
    for (const p of [dim.a, dim.b]) points.push({ x: p.x + nx * (dim.offset + Math.sign(dim.offset) * 10), y: p.y + ny * (dim.offset + Math.sign(dim.offset) * 10) });
  }
  const drawing = bounds(points), margin = Math.max(20, ...plan.walls.map(w => w.thickness / 2 + 2));
  return { x: drawing.x - margin, y: drawing.y - margin, width: drawing.width + margin * 2, height: drawing.height + margin * 2 };
}

export function printLayout(box: { width: number; height: number }, scale: PdfScale) {
  // Half-inch printer margins, plus space for the title and printing notes.
  const margin = 36, top = 72, bottom = 48;
  let paper: { name: string; width: number; height: number };
  let ratio: number;
  if (scale === "fit-a4") {
    const options = [
      { name: "A4", width: A4.width, height: A4.height },
      { name: "A4", width: A4.height, height: A4.width },
    ];
    const requiredRatio = (p: typeof options[number]) => Math.max(box.width * 72 / (p.width - margin * 2), box.height * 72 / (p.height - top - bottom));
    paper = requiredRatio(options[0]) <= requiredRatio(options[1]) ? options[0] : options[1];
    // Round up, then use that SAME ratio for the geometry and printed legend.
    // This gives an exact, readable 1:N scale while keeping every mark on page.
    ratio = Math.max(1, Math.ceil(requiredRatio(paper)));
  } else {
    ratio = 12 / scale;
    const drawingWidth = box.width * 72 / ratio, drawingHeight = box.height * 72 / ratio;
    const papers = [
      { name: "Letter", width: 792, height: 612 }, { name: "Tabloid", width: 1224, height: 792 },
      { name: "ARCH C", width: 1728, height: 1296 }, { name: "ARCH D", width: 2592, height: 1728 },
      { name: "ARCH E", width: 3456, height: 2592 },
    ];
    paper = papers.find(p => drawingWidth <= p.width - margin * 2 && drawingHeight <= p.height - top - bottom) ?? {
      name: "Custom", width: Math.ceil((drawingWidth + margin * 2) / 72) * 72, height: Math.ceil((drawingHeight + top + bottom) / 72) * 72,
    };
  }
  const pointsPerInch = 72 / ratio, drawingWidth = box.width * pointsPerInch, drawingHeight = box.height * pointsPerInch;
  const orientation = paper.width > paper.height ? "landscape" : "portrait";
  const imperial = scale === 0.25 ? '1/4"' : scale === 0.125 ? '1/8"' : '1/16"';
  return {
    ...paper, orientation, ratio, pointsPerInch, drawingWidth, drawingHeight,
    x: (paper.width - drawingWidth) / 2, y: bottom + (paper.height - top - bottom - drawingHeight) / 2,
    scaleLabel: scale === "fit-a4" ? `1:${ratio}` : `${imperial} = 1'-0" (1:${ratio})`,
  };
}
