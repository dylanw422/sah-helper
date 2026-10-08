import { bounds, detectRooms, distance, lerp, project, samePoint, wallFaceGeometry, type Room } from "./geometry";
import type { Plan, Point, Wall } from "./model";
import { roomDimensions } from "./room-dimensions";
export type Dimension = { id: string; a: Point; b: Point; offset: number; value: number; overall?: boolean; roomId?: string; openingId?: string; hideLabel?: boolean; interior?: boolean; doorway?: boolean };

function exteriorOffset(wall: Wall, a: Point, b: Point, rooms: Room[]): number {
  const midpoint = lerp(a, b, 0.5);
  for (const room of rooms) {
    if (!room.wallIds.includes(wall.id)) continue;
    for (let i = 0; i < room.points.length; i++) {
      const start = room.points[i], end = room.points[(i + 1) % room.points.length];
      if (project(midpoint, start, end).distance >= 0.01) continue;
      // Room boundaries run with the interior on their left. Reverse the
      // offset when the wall was drawn against that boundary direction.
      const alignment = (b.x - a.x) * (end.x - start.x) + (b.y - a.y) * (end.y - start.y);
      return alignment > 0 ? -30 : 30;
    }
  }
  return -30;
}

export function automaticDimensions(plan: Pick<Plan, "walls" | "openings">, suppliedRooms?: Room[]): Dimension[] {
  const dims: Dimension[] = [];
  const rooms = suppliedRooms ?? detectRooms(plan.walls);
  const roomWallIds = new Set(rooms.flatMap(r => r.wallIds));
  const exterior = plan.walls.filter(w => w.kind === "exterior");
  const points = exterior.flatMap(w => [w.a, w.b]);
  if (points.length > 2) {
    const box = bounds(points);
    const all = plan.walls.flatMap(w => [w.a, w.b]);
    const unique = (values: number[]) => [...new Set(values.map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);
    const sides = [
      { name: "north", horizontal: true, fixed: box.y, lo: box.x, hi: box.x + box.width, offset: -36 },
      { name: "south", horizontal: true, fixed: box.y + box.height, lo: box.x, hi: box.x + box.width, offset: 36 },
      { name: "west", horizontal: false, fixed: box.x, lo: box.y, hi: box.y + box.height, offset: 36 },
      { name: "east", horizontal: false, fixed: box.x + box.width, lo: box.y, hi: box.y + box.height, offset: -36 },
    ];
    for (const side of sides) {
      const onSide = (p: Point) => Math.abs((side.horizontal ? p.y : p.x) - side.fixed) < 0.01;
      const sideWalls = exterior.filter(w => onSide(w.a) && onSide(w.b));
      if (!sideWalls.length) continue;
      const openingPoints = plan.openings.filter(o => sideWalls.some(w => w.id === o.wallId)).flatMap(o => {
        const w = sideWalls.find(w => w.id === o.wallId)!;
        const length = distance(w.a, w.b), t1 = o.t - o.width / 2 / length, t2 = o.t + o.width / 2 / length;
        return [t1, t2].map(t => ({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t }));
      });
      const ticks = unique([...all.filter(onSide), ...openingPoints].map(p => side.horizontal ? p.x : p.y));
      const makePoint = (v: number): Point => side.horizontal ? { x: v, y: side.fixed } : { x: side.fixed, y: v };
      for (let i = 0; i < ticks.length - 1; i++) {
        const a = makePoint(ticks[i]), b = makePoint(ticks[i + 1]);
        // Do not measure across gaps between disconnected exterior segments.
        const mid = makePoint((ticks[i] + ticks[i + 1]) / 2);
        if (sideWalls.some(w => project(mid, w.a, w.b).distance < 0.01))
          dims.push({ id: `exterior:side:${side.name}:segment:${i}`, a, b, value: ticks[i + 1] - ticks[i], offset: side.offset });
      }
      if (ticks.length > 2) dims.push({ id: `exterior:side:${side.name}:overall`, a: makePoint(ticks[0]), b: makePoint(ticks[ticks.length - 1]), value: ticks[ticks.length - 1] - ticks[0], offset: side.offset * 1.7, overall: true });
    }
  }
  for (const wall of plan.walls) {
    // Room dimensions include jambs and clear spans on both wall faces.
    // Keep centerline dimensions for partitions that do not enclose a room.
    if (wall.kind === "interior" && roomWallIds.has(wall.id)) continue;
    if (wall.kind === "exterior" && points.length > 2) {
      const box = bounds(points);
      const onBounds = (a: Point, b: Point) => (Math.abs(a.x - b.x) < 0.01 && (Math.abs(a.x - box.x) < 0.01 || Math.abs(a.x - box.x - box.width) < 0.01)) || (Math.abs(a.y - b.y) < 0.01 && (Math.abs(a.y - box.y) < 0.01 || Math.abs(a.y - box.y - box.height) < 0.01));
      if (onBounds(wall.a, wall.b)) continue;
    }
    const ticks = plan.walls.flatMap(w => [w.a, w.b]).filter(p => project(p, wall.a, wall.b).distance < 0.01);
    for (const opening of plan.openings.filter(o => o.wallId === wall.id)) {
      const length = distance(wall.a, wall.b);
      for (const t of [opening.t - opening.width / 2 / length, opening.t + opening.width / 2 / length])
        ticks.push({ x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t });
    }
    // Include crossing partitions even when neither endpoint is on this wall.
    for (const other of plan.walls) {
      if (other.id === wall.id) continue;
      const dx = wall.b.x - wall.a.x, dy = wall.b.y - wall.a.y, ox = other.b.x - other.a.x, oy = other.b.y - other.a.y;
      const denominator = dx * oy - dy * ox;
      if (Math.abs(denominator) < 0.01) continue;
      const cx = other.a.x - wall.a.x, cy = other.a.y - wall.a.y;
      const t = (cx * oy - cy * ox) / denominator, u = (cx * dy - cy * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ticks.push({ x: wall.a.x + t * dx, y: wall.a.y + t * dy });
    }
    const sorted = ticks.sort((a, b) => project(a, wall.a, wall.b).t - project(b, wall.a, wall.b).t).filter((p, i, arr) => !i || !samePoint(p, arr[i - 1]));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      dims.push({ id: `wall:${wall.id}:segment:${i}`, a, b, value: distance(a, b), offset: wall.kind === "interior" ? -16 : exteriorOffset(wall, a, b, rooms), interior: wall.kind === "interior" });
    }
  }
  const dimensions = [...dims, ...roomDimensions(plan, rooms)];
  const wallBodies = wallFaceGeometry(plan.walls, rooms);
  for (const opening of plan.openings) {
    if (opening.kind === "window") continue;
    const wall = wallBodies.find(w => w.id === opening.wallId);
    if (!wall) continue;
    const length = distance(wall.a, wall.b);
    if (length < 0.5) continue;
    const half = opening.width / (2 * length);
    const a = lerp(wall.a, wall.b, opening.t - half), b = lerp(wall.a, wall.b, opening.t + half);
    const wallSpans = dimensions.filter(d => d.id.startsWith(`wall:${wall.id}:segment:`)
      && Math.min(project(d.a, wall.a, wall.b).t, project(d.b, wall.a, wall.b).t) >= opening.t - half - 1e-8
      && Math.max(project(d.a, wall.a, wall.b).t, project(d.b, wall.a, wall.b).t) <= opening.t + half + 1e-8);
    // Replace the width label in the room/wall chain with a jamb-to-jamb
    // measurement centered in the actual gap. Exterior chains stay intact.
    const dim = dimensions.find(d => d.openingId === opening.id && !d.hideLabel)
      ?? wallSpans[0];
    for (const span of wallSpans) if (span !== dim) span.hideLabel = true;
    if (dim) Object.assign(dim, { a, b, value: opening.width, offset: 0, openingId: opening.id, interior: true, doorway: true });
    else dimensions.push({ id: `doorway:${opening.id}`, a, b, value: opening.width, offset: 0, openingId: opening.id, interior: true, doorway: true });
  }
  return dimensions;
}
export function wallSegments(wall: Wall, plan: Pick<Plan, "openings">): { a: Point; b: Point }[] {
  const length = distance(wall.a, wall.b);
  if (length < 0.5) return [];
  const intervals = plan.openings.filter(o => o.wallId === wall.id).map(o => [Math.max(0, o.t - o.width / 2 / length), Math.min(1, o.t + o.width / 2 / length)]).sort((a, b) => a[0] - b[0]);
  const segments: { a: Point; b: Point }[] = [];
  const at = (t: number) => ({ x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t });
  let cursor = 0;
  for (const [start, end] of intervals) { if (start > cursor) segments.push({ a: at(cursor), b: at(start) }); cursor = Math.max(cursor, end); }
  if (cursor < 1) segments.push({ a: at(cursor), b: at(1) });
  return segments;
}
