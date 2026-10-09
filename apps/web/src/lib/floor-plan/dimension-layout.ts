import type { Dimension } from "./dimensions";
import { distance, lerp } from "./geometry";
import { formatLength, type Point } from "./model";

export type LabelBounds = { x: number; y: number; width: number; height: number; corners?: Point[] };
export type DimensionLayout = { dimension: Dimension; fontSize: number; labelBounds?: LabelBounds; label?: string; labelPosition?: Point };
export const MIN_DISPLAY_DIMENSION = 6;
// SVG font sizes use CSS pixels; one typographic point is 4/3 pixels.
export const DIMENSION_FONT_REDUCTION = 4 / 3;

export function dimensionLabel(value: number) {
  return formatLength(value).replace(/^0′ /, "");
}

function compactDimensionLabel(value: number) {
  const label = dimensionLabel(value).replace(/ 0″$/, "");
  const parts = formatLength(value).match(/^(\d+)′ (\d+)(.*)$/);
  const inches = parts ? `${Number(parts[1]) * 12 + Number(parts[2])}${parts[3]}` : label;
  return inches.length < label.length ? inches : label;
}

export function labelsOverlap(a: LabelBounds, b: LabelBounds, gap = 0) {
  if (!(a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y)) return false;
  if (!a.corners && !b.corners) return true;
  const corners = (box: LabelBounds) => box.corners ?? [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }];
  const ca = corners(a), cb = corners(b);
  for (const polygon of [ca, cb]) for (let i = 0; i < 2; i++) {
    const start = polygon[i], end = polygon[i + 1], length = distance(start, end);
    const nx = -(end.y - start.y) / length, ny = (end.x - start.x) / length;
    const pa = ca.map(p => p.x * nx + p.y * ny), pb = cb.map(p => p.x * nx + p.y * ny);
    if (Math.max(...pa) + gap <= Math.min(...pb) || Math.max(...pb) + gap <= Math.min(...pa)) return false;
  }
  return true;
}

function labelGeometry(dim: Dimension, fontSize: number, label: string, padding: number, along = .5) {
  const length = distance(dim.a, dim.b), ux = (dim.b.x - dim.a.x) / length, uy = (dim.b.y - dim.a.y) / length;
  const nx = -uy, ny = ux, midpoint = lerp(dim.a, dim.b, along);
  const width = label.length * fontSize * .62 + padding, height = fontSize * 1.2 + padding;
  const above = dim.interior ? 0 : -4 - fontSize * .35;
  const angle = Math.atan2(uy, ux) * 180 / Math.PI;
  const upright = angle > 90 || angle < -90 ? -1 : 1;
  const center = { x: midpoint.x + nx * (dim.offset + above * upright), y: midpoint.y + ny * (dim.offset + above * upright) };
  const boxWidth = Math.abs(ux) * width + Math.abs(uy) * height;
  const boxHeight = Math.abs(uy) * width + Math.abs(ux) * height;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: center.x + ux * width / 2 * x + nx * height / 2 * y, y: center.y + uy * width / 2 * x + ny * height / 2 * y }));
  return { width, height, center, box: { x: center.x - boxWidth / 2, y: center.y - boxHeight / 2, width: boxWidth, height: boxHeight, corners } };
}

// Pick one face of matching opposite spans before fitting their labels. Keep
// doorway widths independent so each physical opening remains measurable.
export function uniqueRoomDimensions(dimensions: Dimension[]): Dimension[] {
  const duplicateIds = new Set<string>(), retained: Dimension[] = [];
  const candidates = dimensions.filter(dim => dim.roomId && !dim.doorway).sort((a, b) => Number(!!b.exteriorFace) - Number(!!a.exteriorFace) || Number(!!a.hideLabel) - Number(!!b.hideLabel) || a.id.localeCompare(b.id));
  for (const dim of candidates) {
    const duplicate = retained.some(other => {
      if (other.roomId !== dim.roomId || Math.abs(other.value - dim.value) > .01) return false;
      const length = distance(other.a, other.b), otherLength = distance(dim.a, dim.b);
      if (length < .5 || otherLength < .5) return false;
      const ux = (other.b.x - other.a.x) / length, uy = (other.b.y - other.a.y) / length;
      // Opposite room faces run in opposite directions and face one another.
      if ((ux * (dim.b.x - dim.a.x) + uy * (dim.b.y - dim.a.y)) / otherLength > -1 + 1e-8) return false;
      if (-uy * (dim.a.x - other.a.x) + ux * (dim.a.y - other.a.y) <= .01) return false;
      const along = [dim.a, dim.b].map(p => (p.x - other.a.x) * ux + (p.y - other.a.y) * uy);
      // Compare the actual span, not just its printed length. Different jamb
      // and partition chains on the opposite face must remain measurable.
      return Math.abs(Math.min(...along)) < .01 && Math.abs(Math.max(...along) - length) < .01;
    });
    if (duplicate) duplicateIds.add(dim.id);
    else retained.push(dim);
  }
  return dimensions.filter(dim => !duplicateIds.has(dim.id));
}

// Presentation only: retain every measured span and stable ID for geometry
// and editing, while choosing readable labels for the current drawing scale.
export function layoutDimensions(dimensions: Dimension[], scale = 1, fixedObstacles: LabelBounds[] = []): DimensionLayout[] {
  // Keep a minimum size in drawing coordinates. Above 100% zoom, the SVG
  // magnifies the text along with the plan instead of shrinking its font.
  const fontScale = Math.min(1, Math.max(scale, .01));
  const primary = new Map<string, Dimension>();
  const visible = uniqueRoomDimensions(dimensions.filter(dim => dim.value >= MIN_DISPLAY_DIMENSION - 1e-8));
  for (const dim of visible) {
    if (!dim.roomId || dim.hideLabel || dim.doorway) continue;
    let angle = Math.atan2(dim.b.y - dim.a.y, dim.b.x - dim.a.x);
    if (angle < 0) angle += Math.PI;
    const key = `${dim.roomId}:${Math.round(angle * 10000) % Math.round(Math.PI * 10000)}`;
    const previous = primary.get(key);
    if (!previous || dim.value > previous.value) primary.set(key, dim);
  }
  const main = new Set(primary.values());
  const rank = (dim: Dimension) => dim.doorway ? 0 : dim.overall ? 1 : main.has(dim) ? 2 : 3;
  const padding = Math.min(4, 4 / Math.max(scale, .01));
  const gap = Math.min(2, 2 / Math.max(scale, .01));
  const placed: LabelBounds[] = [...fixedObstacles], layouts = new Map<string, DimensionLayout>();
  for (const dim of [...visible].sort((a, b) => rank(a) - rank(b) || b.value - a.value || a.id.localeCompare(b.id))) {
    const length = distance(dim.a, dim.b), label = dimensionLabel(dim.value);
    let fontSize = (dim.overall ? 13 : 11) / fontScale;
    if (dim.doorway) fontSize = Math.min(fontSize, Math.max(1, length - 4) / (label.length * .62));
    fontSize = Math.max(.1 / fontScale, fontSize - DIMENSION_FONT_REDUCTION / fontScale);
    const layout: DimensionLayout = { dimension: dim, fontSize };
    layouts.set(dim.id, layout);
    if (dim.hideLabel || length < .5) continue;
    const { width, box } = labelGeometry(dim, fontSize, label, padding);
    if ((!dim.doorway && width > length) || placed.some(other => labelsOverlap(box, other, gap))) {
      layout.dimension = { ...dim, hideLabel: true };
    } else {
      layout.labelBounds = box;
      placed.push(box);
    }
  }
  // Keep the room's remaining measuring directions readable, including a
  // single interior direction when the other is already shown outside. Try
  // shorter labels and positions along each span before hiding a measurement.
  const roomIds = new Set([...primary.values()].map(dim => dim.roomId!));
  for (const roomId of roomIds) {
    const directions = [...primary.values()].filter(dim => dim.roomId === roomId).sort((a, b) => b.value - a.value).slice(0, 2);
    if (!directions.length || directions.length === 1 && !fixedObstacles.length) continue;
    const aligned = (a: Dimension, b: Dimension) => Math.abs((a.b.x - a.a.x) * (b.b.y - b.a.y) - (a.b.y - a.a.y) * (b.b.x - b.a.x)) < distance(a.a, a.b) * distance(b.a, b.b) * .0001;
    const hasDirection = (direction: Dimension) => [...layouts.values()].some(mark => mark.dimension.roomId === roomId && mark.labelBounds && !mark.dimension.doorway && aligned(mark.dimension, direction));
    if (directions.every(hasDirection)) continue;
    const roomMarks = [...layouts.values()].filter(mark => mark.dimension.roomId === roomId && !mark.dimension.doorway);
    const obstacles = [...fixedObstacles, ...[...layouts.values()].filter(mark => !roomMarks.includes(mark)).flatMap(mark => mark.labelBounds ? [mark.labelBounds] : [])];
    const candidates = (direction: Dimension): DimensionLayout[] => {
      const result: DimensionLayout[] = [];
      const compactPadding = Math.min(padding, 3 / Math.max(scale, .01), 3);
      const faces = visible.filter(dim => dim.roomId === roomId && !dim.doorway && !dim.hideLabel && aligned(dim, direction)).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
      for (const screenSize of [11, 9, 8]) for (const compact of [false, true]) for (const dim of faces) {
        const fontSize = (screenSize - DIMENSION_FONT_REDUCTION) / fontScale, length = distance(dim.a, dim.b);
        const label = compact ? compactDimensionLabel(dim.value) : dimensionLabel(dim.value);
        const { width, height } = labelGeometry(dim, fontSize, label, compactPadding);
        if (width > length) continue;
        for (const offset of [dim.offset, height / 2]) for (const along of [.5, width / (2 * length), 1 - width / (2 * length)]) {
          const dimension = { ...dim, offset }, geometry = labelGeometry(dimension, fontSize, label, compactPadding, along);
          if (obstacles.some(other => labelsOverlap(geometry.box, other, gap))) continue;
          result.push({ dimension, fontSize, label, labelPosition: geometry.center, labelBounds: geometry.box });
        }
      }
      return result;
    };
    const first = candidates(directions[0]);
    let chosen: DimensionLayout[] | undefined;
    if (directions.length === 1) chosen = first.slice(0, 1);
    else {
      const second = candidates(directions[1]);
      for (const a of first) {
        const b = second.find(mark => !labelsOverlap(a.labelBounds!, mark.labelBounds!));
        if (b) { chosen = [a, b]; break; }
      }
    }
    if (!chosen?.length) continue;
    for (const mark of roomMarks) layouts.set(mark.dimension.id, { dimension: { ...mark.dimension, hideLabel: true }, fontSize: mark.fontSize });
    for (const mark of chosen) layouts.set(mark.dimension.id, mark);
  }
  return visible.map(dim => layouts.get(dim.id)!);
}

// Exterior labels supply the room's clear measurements whenever their
// projected endpoints match. Keep different spans and actual doorway widths.
export function displayedDimensionLayout(dimensions: Dimension[], scale = 1): DimensionLayout[] {
  const outside = layoutDimensions(dimensions.filter(dim => !dim.interior || dim.doorway), scale);
  const measuredOutside = outside.filter(mark => !mark.dimension.interior && mark.labelBounds).map(mark => mark.dimension);
  const covered = (dim: Dimension) => measuredOutside.some(other => {
    if (Math.abs(other.value - dim.value) > .01) return false;
    const length = distance(other.a, other.b), dimLength = distance(dim.a, dim.b);
    const ux = (other.b.x - other.a.x) / length, uy = (other.b.y - other.a.y) / length;
    if (Math.abs(ux * (dim.b.y - dim.a.y) - uy * (dim.b.x - dim.a.x)) / dimLength > .0001) return false;
    const along = [dim.a, dim.b].map(p => (p.x - other.a.x) * ux + (p.y - other.a.y) * uy);
    return Math.abs(Math.min(...along)) < .01 && Math.abs(Math.max(...along) - length) < .01;
  });
  const inside = layoutDimensions(dimensions.filter(dim => dim.interior && !dim.doorway && !covered(dim)), scale,
    outside.flatMap(mark => mark.labelBounds ? [mark.labelBounds] : []));
  const marks = new Map([...outside, ...inside].map(mark => [mark.dimension.id, mark]));
  return dimensions.flatMap(dim => marks.has(dim.id) ? [marks.get(dim.id)!] : []);
}
