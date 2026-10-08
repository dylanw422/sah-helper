import { wallSegments } from "./dimensions";
import { distance, fixtureCorners, wallFaceGeometry } from "./geometry";
import type { Fixture, Plan, Point } from "./model";
import { snapFixtureToWalls } from "./fixture-snapping";

const EPS = 1e-6;
const clean = (value: number) => Math.round(value * 1e9) / 1e9;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const axes = (rotation: number) => {
  const angle = rotation * Math.PI / 180;
  return [{ x: Math.cos(angle), y: Math.sin(angle) }, { x: -Math.sin(angle), y: Math.cos(angle) }];
};
export const isCabinet = (fixture: Fixture) => fixture.catalogId === "cabinet" || fixture.catalogId === "counter";
type CabinetPlan = Pick<Plan, "walls" | "openings" | "fixtures">;
function freeGaps(occupied: { lo: number; hi: number }[]) {
  const intervals: { lo: number; hi: number }[] = [];
  for (const interval of occupied.sort((a, b) => a.lo - b.lo)) {
    const previous = intervals[intervals.length - 1];
    if (previous && interval.lo <= previous.hi + EPS) previous.hi = Math.max(previous.hi, interval.hi);
    else intervals.push({ ...interval });
  }
  return Array.from({ length: intervals.length + 1 }, (_, i) => ({ lo: i ? intervals[i - 1].hi : -Infinity, hi: i < intervals.length ? intervals[i].lo : Infinity }));
}

function wallBoxes(plan: CabinetPlan) {
  return wallFaceGeometry(plan.walls).flatMap(wall => wallSegments(wall, plan).map(segment => ({
    id: wall.id, catalogId: "wall", x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2,
    width: distance(segment.a, segment.b), depth: wall.thickness,
    rotation: Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x) * 180 / Math.PI,
  })));
}

function overlaps(a: Fixture, b: Fixture) {
  const ca = fixtureCorners(a), cb = fixtureCorners(b);
  return [...axes(a.rotation), ...axes(b.rotation)].every(axis => {
    const pa = ca.map(p => dot(p, axis)), pb = cb.map(p => dot(p, axis));
    return Math.max(...pa) > Math.min(...pb) + EPS && Math.max(...pb) > Math.min(...pa) + EPS;
  });
}

export function cabinetPlacementClear(fixture: Fixture, plan: CabinetPlan) {
  return [...plan.fixtures.filter(other => other.id !== fixture.id), ...wallBoxes(plan)].every(other => !overlaps(fixture, other));
}

// Fit the cabinet across the free part of its row. Cabinet backs align with
// nearby wall faces or object backs; the sides use the actual object footprints.
export function snapCabinet(fixture: Fixture, plan: CabinetPlan, tolerance: number, fallback: Point = fixture): Fixture {
  const base = { ...fixture, ...snapFixtureToWalls(fixture, plan, tolerance, fallback) };
  if (!isCabinet(fixture)) return base;
  const [u, v] = axes(fixture.rotation);
  const fixtures = plan.fixtures.filter(other => other.id !== fixture.id);
  const walls = wallBoxes(plan), obstacles = [...fixtures, ...walls];
  const boxes = obstacles.map((other, index) => {
    const corners = fixtureCorners(other), x = corners.map(p => dot(p, u)), y = corners.map(p => dot(p, v));
    return { minX: Math.min(...x), maxX: Math.max(...x), minY: Math.min(...y), maxY: Math.max(...y), object: index < fixtures.length };
  });
  const clear = (candidate: Fixture) => obstacles.every(other => !overlaps(candidate, other));
  const at = (x: number, y: number, width: number, depth: number): Fixture => ({ ...fixture, x: clean(u.x * x + v.x * y), y: clean(u.y * x + v.y * y), width: clean(Math.max(1, Math.min(600, width))), depth: clean(Math.max(1, Math.min(600, depth))) });
  const rawX = dot(fixture, u), rawY = dot(fixture, v);
  const rows = [{ y: dot(base, v), depth: fixture.depth, contacts: 0 }];
  const addRow = (y: number) => {
    if (Math.abs(y - rawY) <= tolerance + EPS && !rows.some(row => row.contacts && Math.abs(row.y - y) < EPS)) rows.push({ y, depth: fixture.depth, contacts: 1 });
  };
  for (const other of fixtures) {
    if (Math.abs(dot(u, axes(other.rotation)[0])) < 1 - EPS) continue;
    const corners = fixtureCorners(other);
    const x = corners.map(p => dot(p, u));
    if (rawX < Math.min(...x) - fixture.width - tolerance || rawX > Math.max(...x) + fixture.width + tolerance) continue;
    addRow(Math.min(...corners.map(p => dot(p, v))) + fixture.depth / 2);
  }
  for (const wall of walls) {
    if (Math.abs(dot(u, axes(wall.rotation)[0])) < 1 - EPS) continue;
    const x = fixtureCorners(wall).map(p => dot(p, u));
    if (rawX < Math.min(...x) - fixture.width / 2 - tolerance || rawX > Math.max(...x) + fixture.width / 2 + tolerance) continue;
    const y = dot(wall, v);
    addRow(y - (wall.depth + fixture.depth) / 2);
    addRow(y + (wall.depth + fixture.depth) / 2);
  }
  // A shallow space can also reduce the cabinet depth. Width is fitted next,
  // so use the pointer's column rather than the as-yet-unfitted full width.
  for (const { lo, hi } of freeGaps(boxes.filter(box => box.minX < rawX - EPS && box.maxX > rawX + EPS).map(box => ({ lo: box.minY, hi: box.maxY })))) {
    const depth = hi - lo, y = (lo + hi) / 2;
    if (depth >= 1 - EPS && depth < fixture.depth - EPS && Math.abs(rawY - y) <= tolerance + (fixture.depth - depth) / 2) rows.push({ y, depth, contacts: 2 });
    else if (rawY >= lo - tolerance && rawY <= hi + tolerance) {
      const start = Math.max(lo, rawY - fixture.depth / 2), end = Math.min(hi, rawY + fixture.depth / 2);
      if (end - start >= 1 - EPS && end - start < fixture.depth - EPS) rows.push({ y: (start + end) / 2, depth: end - start, contacts: 1 });
    }
  }
  const candidates: { fixture: Fixture; contacts: number }[] = [];
  if (clear(base)) candidates.push({ fixture: base, contacts: 0 });
  for (const row of rows) {
    const occupied = boxes.filter(box => box.maxY > row.y - row.depth / 2 + EPS && box.minY < row.y + row.depth / 2 - EPS).map(box => ({ lo: box.minX, hi: box.maxX }));
    for (const { lo, hi } of freeGaps(occupied)) {
      const gap = hi - lo;
      if (gap < 1 - EPS || rawX < lo - tolerance || rawX > hi + tolerance) continue;
      let width = fixture.width, x = dot(base, u), contacts = row.contacts;
      const center = (lo + hi) / 2;
      const objectBoundary = boxes.some(box => box.object && box.maxY > row.y - row.depth / 2 + EPS && box.minY < row.y + row.depth / 2 - EPS && (Math.abs(box.maxX - lo) < EPS || Math.abs(box.minX - hi) < EPS));
      const centered = Math.abs(rawX - center) <= tolerance + EPS && Math.abs(rawX - center) <= Math.min(Math.abs(rawX - lo - fixture.width / 2), Math.abs(rawX - hi + fixture.width / 2)) + EPS;
      // Close a small remainder automatically. A larger span grows when the
      // pointer targets its center and an adjacent object defines the run.
      const fillGap = gap <= 600 + EPS && (gap <= fixture.width + EPS || objectBoundary && (gap <= fixture.width * 1.5 + EPS || centered));
      if (fillGap) {
        width = gap; x = (lo + hi) / 2;
        if (Math.abs(rawX - x) > tolerance + Math.abs(fixture.width - width) / 2) continue;
        contacts += 2;
      } else {
        const sides = [lo + width / 2, hi - width / 2].filter(value => Number.isFinite(value) && Math.abs(value - rawX) <= tolerance + EPS).sort((a, b) => Math.abs(a - rawX) - Math.abs(b - rawX));
        if (sides.length) { x = sides[0]; contacts++; }
        x = Math.max(lo + width / 2, Math.min(hi - width / 2, x));
        if (Math.abs(x - rawX) > tolerance + EPS) {
          const start = Math.max(lo, rawX - width / 2), end = Math.min(hi, rawX + width / 2);
          if (end - start < 1 - EPS || end - start >= width - EPS) continue;
          width = end - start; x = (start + end) / 2; contacts++;
        }
      }
      const candidate = at(x, row.y, width, row.depth);
      if (clear(candidate)) candidates.push({ fixture: candidate, contacts });
    }
  }
  return candidates.sort((a, b) => b.contacts - a.contacts || b.fixture.depth - a.fixture.depth || distance(a.fixture, fixture) - distance(b.fixture, fixture))[0]?.fixture ?? base;
}
