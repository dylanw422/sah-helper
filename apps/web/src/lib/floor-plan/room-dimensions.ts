import { distance, lerp, project, wallFaceGeometry, type Room } from "./geometry";
import type { Plan, Point } from "./model";
import type { Dimension } from "./dimensions";

// Measure the inside faces of each bounded room, including the inside faces of
// exterior walls. Collinear graph splits are not separate room corners.
export function roomDimensions(plan: Pick<Plan, "walls" | "openings">, rooms: Room[]): Dimension[] {
  const dimensions: Dimension[] = [];
  const wallBodies = wallFaceGeometry(plan.walls, rooms);
  for (const room of rooms) {
    const corners = room.inner.filter((p, i, points) => project(p, points[(i + points.length - 1) % points.length], points[(i + 1) % points.length]).distance > 0.01);
    const walls = wallBodies.filter(w => room.wallIds.includes(w.id));
    for (let edge = 0; edge < corners.length; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % corners.length], length = distance(a, b);
      if (length < 0.5) continue;
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
      const nx = -dy, ny = dx;
      const along = (p: Point) => (p.x - a.x) * dx + (p.y - a.y) * dy;
      const hostWalls = walls.filter(w => {
        const wl = distance(w.a, w.b);
        return wl > 0 && Math.abs(dx * (w.b.y - w.a.y) - dy * (w.b.x - w.a.x)) / wl < 0.0001
          && Math.abs((w.a.x - a.x) * nx + (w.a.y - a.y) * ny) <= w.thickness / 2 + 0.01
          && Math.max(along(w.a), along(w.b)) > 0 && Math.min(along(w.a), along(w.b)) < length;
      });
      const ticks = [0, length];
      const partitionSpans: { start: number; end: number }[] = [];
      // Dangling partitions are omitted from the room polygon, but their
      // bodies still divide the clear measurement on the face they meet.
      for (const wall of wallBodies) {
        const wallLength = distance(wall.a, wall.b);
        if (wallLength < 0.5) continue;
        const wx = (wall.b.x - wall.a.x) / wallLength, wy = (wall.b.y - wall.a.y) / wallLength;
        if (Math.abs(dx * wy - dy * wx) < 0.0001) continue;
        const ax = a.x - wall.a.x, ay = a.y - wall.a.y;
        let start = 0, end = length;
        // Clip the room edge against the finite wall body, including its
        // end caps. This works for either drawing direction and angled plans.
        for (const [position, slope, lo, hi] of [
          [ax * wx + ay * wy, dx * wx + dy * wy, 0, wallLength],
          [-ax * wy + ay * wx, -dx * wy + dy * wx, -wall.thickness / 2, wall.thickness / 2],
        ]) {
          if (Math.abs(slope) < 1e-8) {
            if (position < lo - 0.01 || position > hi + 0.01) end = start;
          } else {
            const limits = [(lo - position) / slope, (hi - position) / slope];
            start = Math.max(start, Math.min(...limits));
            end = Math.min(end, Math.max(...limits));
          }
        }
        if (end - start <= 0.01) continue;
        partitionSpans.push({ start, end });
        ticks.push(start, end);
      }
      const openingSpans: { id: string; start: number; end: number; door: boolean }[] = [];
      for (const opening of plan.openings) {
        const wall = hostWalls.find(w => w.id === opening.wallId);
        if (!wall) continue;
        const half = opening.width / (2 * distance(wall.a, wall.b));
        const jambs = [opening.t - half, opening.t + half].map(t => along(lerp(wall.a, wall.b, t)));
        if (wall.kind === "interior" || opening.kind !== "window") openingSpans.push({ id: opening.id, start: Math.min(...jambs), end: Math.max(...jambs), door: opening.kind !== "window" });
        for (const value of jambs) {
          if (value > 0.01 && value < length - 0.01) ticks.push(value);
        }
      }
      const sorted = ticks.sort((x, y) => x - y).filter((v, i, values) => !i || v - values[i - 1] > 0.01);
      // Wall geometry alone determines dimension placement. Keep each chain
      // at a fixed distance from its wall and each label at its midpoint.
      const at = (value: number) => ({ x: a.x + dx * value, y: a.y + dy * value });
      for (let i = 0; i < sorted.length - 1; i++) {
        const start = sorted[i], end = sorted[i + 1];
        if (partitionSpans.some(span => (start + end) / 2 > span.start && (start + end) / 2 < span.end)) continue;
        const opening = openingSpans.find(o => o.door ? start >= o.start - 0.01 && end <= o.end + 0.01 : Math.abs(o.start - start) < 0.01 && Math.abs(o.end - end) < 0.01);
        dimensions.push({ id: `room:${room.id}:edge:${edge}:segment:${i}`, roomId: room.id, openingId: opening?.id, a: at(start), b: at(end), value: end - start, offset: 14, interior: true });
      }
    }
  }
  // Keep both jamb chains, but label each shared opening only once. Prefer the
  // door's swing side; windows use the same fixed wall side. Fall back to the
  // available face when the preferred side does not enclose a room.
  const labels = new Map<string, Dimension>();
  const openings = new Map(plan.openings.map(o => [o.id, o]));
  const walls = new Map(plan.walls.map(w => [w.id, w]));
  const preferredSide = (dim: Dimension) => {
    const opening = openings.get(dim.openingId!)!, wall = walls.get(opening.wallId)!;
    const center = lerp(dim.a, dim.b, 0.5);
    const side = (wall.b.x - wall.a.x) * (center.y - wall.a.y) - (wall.b.y - wall.a.y) * (center.x - wall.a.x);
    return (opening.kind === "door" && opening.flip ? -side : side) > 0;
  };
  for (const dim of dimensions) {
    if (!dim.openingId) continue;
    const previous = labels.get(dim.openingId);
    if (!previous) labels.set(dim.openingId, dim);
    else if (preferredSide(dim) && !preferredSide(previous)) {
      previous.hideLabel = true;
      labels.set(dim.openingId, dim);
    } else dim.hideLabel = true;
  }
  return dimensions;
}
