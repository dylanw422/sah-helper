import { wallSegments } from "./dimensions";
import { bounds, distance, fitOpening, fixtureCorners, lerp, pointInPolygon, project } from "./geometry";
import { parsePlan, type Layers, type Plan, type Point, type Selection } from "./model";
import { constrainWallAngles } from "./wall-constraints";
import { noteCorners } from "./notes";

export const selectionKey = (s: Selection) => `${s.type}:${s.id}`;
export function mergeSelections(a: Selection[], b: Selection[]) {
  return [...new Map([...a, ...b].filter(s => s.type !== "room").map(s => [selectionKey(s), s])).values()];
}

function segmentPolygon(a: Point, b: Point, width: number) {
  const length = distance(a, b), ux = length ? (b.x - a.x) / length : 1, uy = length ? (b.y - a.y) / length : 0, half = width / 2;
  return [[-half, -half], [length + half, -half], [length + half, half], [-half, half]].map(([x, y]) => ({ x: a.x + ux * x - uy * y, y: a.y + uy * x + ux * y }));
}
function openingPolygon(plan: Plan, id: string) {
  const o = plan.openings.find(o => o.id === id), w = plan.walls.find(w => w.id === o?.wallId);
  if (!o || !w) return [];
  const center = lerp(w.a, w.b, o.t), length = distance(w.a, w.b), ux = (w.b.x - w.a.x) / length, uy = (w.b.y - w.a.y) / length;
  const half = w.thickness / 2, low = o.kind === "door" && o.flip ? -o.width : -half, high = o.kind === "door" && !o.flip ? o.width : half;
  return [[-o.width / 2, low], [o.width / 2, low], [o.width / 2, high], [-o.width / 2, high]].map(([x, y]) => ({ x: center.x + ux * x - uy * y, y: center.y + uy * x + ux * y }));
}
function notePolygon(note: Plan["notes"][number]) {
  const [a, b] = noteCorners(note);
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}
function selectionPolygons(plan: Plan, selection: Selection): Point[][] {
  if (selection.type === "wall") {
    const w = plan.walls.find(w => w.id === selection.id);
    return w ? wallSegments(w, plan).map(s => segmentPolygon(s.a, s.b, w.thickness)) : [];
  }
  if (selection.type === "opening") return [openingPolygon(plan, selection.id)];
  if (selection.type === "fixture") { const f = plan.fixtures.find(f => f.id === selection.id); return f ? [fixtureCorners(f)] : []; }
  if (selection.type === "text") { const n = plan.notes.find(n => n.id === selection.id); return n ? [notePolygon(n)] : []; }
  if (selection.type === "utility") { const u = plan.utilities.find(u => u.id === selection.id); return u ? [segmentPolygon(u.a, u.b, 1.5)] : []; }
  return [];
}
export function visibleSelections(plan: Plan, layers: Layers): Selection[] {
  return [
    ...plan.walls.map(w => ({ type: "wall" as const, id: w.id })),
    ...plan.openings.map(o => ({ type: "opening" as const, id: o.id })),
    ...(layers.fixtures ? plan.fixtures.map(f => ({ type: "fixture" as const, id: f.id })) : []),
    ...(layers.utilities ? plan.utilities.map(u => ({ type: "utility" as const, id: u.id })) : []),
    ...(layers.notes ? plan.notes.map(n => ({ type: "text" as const, id: n.id })) : []),
  ];
}
export function selectionBounds(plan: Plan, selections: Selection[]) {
  const points = selections.flatMap(s => selectionPolygons(plan, s).flat());
  return points.length ? bounds(points) : null;
}

// Clip each polygon edge against the box; bounding-box overlap alone would
// select angled walls and rotated furniture that never touch the marquee.
function intersectsBox(polygon: Point[], a: Point, b: Point) {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  if (polygon.some(p => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y)) return true;
  if ([lo, hi, { x: lo.x, y: hi.y }, { x: hi.x, y: lo.y }].some(p => pointInPolygon(p, polygon))) return true;
  return polygon.some((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    let start = 0, end = 1;
    for (const axis of ["x", "y"] as const) {
      const delta = q[axis] - p[axis];
      if (Math.abs(delta) < 1e-10) { if (p[axis] < lo[axis] || p[axis] > hi[axis]) return false; }
      else { const t1 = (lo[axis] - p[axis]) / delta, t2 = (hi[axis] - p[axis]) / delta; start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2)); }
    }
    return start <= end;
  });
}
export function selectInBox(plan: Plan, a: Point, b: Point, layers: Layers) {
  return visibleSelections(plan, layers).filter(s => selectionPolygons(plan, s).some(poly => intersectsBox(poly, a, b)));
}

export function deleteSelection(plan: Plan, selections: Selection[]): Plan {
  const keys = new Set(selections.map(selectionKey)), has = (type: Selection["type"], id: string) => keys.has(`${type}:${id}`);
  return { ...plan,
    walls: plan.walls.filter(w => !has("wall", w.id)),
    openings: plan.openings.filter(o => !has("opening", o.id) && !has("wall", o.wallId)),
    fixtures: plan.fixtures.filter(f => !has("fixture", f.id)),
    utilities: plan.utilities.filter(u => !has("utility", u.id)),
    notes: plan.notes.filter(n => !has("text", n.id)),
  };
}

export function moveSelection(plan: Plan, selections: Selection[], delta: Point): Plan {
  const keys = new Set(selections.map(selectionKey)), has = (type: Selection["type"], id: string) => keys.has(`${type}:${id}`);
  const movedWalls = plan.walls.filter(w => has("wall", w.id));
  const translate = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  // Shared corners and endpoints of attached walls follow exactly once, even
  // when multiple selected walls meet at the same junction.
  const moveEndpoint = (p: Point) => movedWalls.some(w => project(p, w.a, w.b).distance < .01) ? translate(p) : p;
  const proposed = plan.walls.map(w => has("wall", w.id) ? { ...w, a: translate(w.a), b: translate(w.b) } : { ...w, a: moveEndpoint(w.a), b: moveEndpoint(w.b) });
  if (proposed.some(w => distance(w.a, w.b) < 1)) throw new Error("This move would collapse an attached wall. Choose a different position.");
  const walls = constrainWallAngles(plan.walls, proposed, new Map(movedWalls.map(w => [w.id, translate(lerp(w.a, w.b, .5))])));
  if (!walls) throw new Error("This move cannot keep the existing 90° wall junctions connected. Choose a different position.");
  if (walls.some(w => distance(w.a, w.b) < 1)) throw new Error("This move would collapse an attached wall. Choose a different position.");
  const openings = plan.openings.map(o => {
    if (!has("opening", o.id) || has("wall", o.wallId)) return o;
    const oldWall = plan.walls.find(w => w.id === o.wallId)!, wall = walls.find(w => w.id === o.wallId)!;
    return { ...o, t: project(translate(lerp(oldWall.a, oldWall.b, o.t)), wall.a, wall.b).t };
  });
  for (const opening of openings) {
    if (!movedWalls.length && !has("opening", opening.id)) continue;
    const wall = walls.find(w => w.id === opening.wallId)!, t = fitOpening(wall, opening.width, opening.t, openings, opening.id, { kind: opening.kind, walls });
    if (t === null || Math.abs(t - opening.t) * distance(wall.a, wall.b) > .01) throw new Error("This move would push an opening beyond its wall, overlap another opening, or leave less than 4″ between a door or window and an adjacent wall. Choose a different position.");
  }
  return parsePlan({ ...plan, walls, openings,
    fixtures: plan.fixtures.map(f => has("fixture", f.id) ? { ...f, ...translate(f) } : f),
    notes: plan.notes.map(n => has("text", n.id) ? { ...n, ...translate(n) } : n),
    utilities: plan.utilities.map(u => has("utility", u.id) ? { ...u, a: translate(u.a), b: translate(u.b) } : u),
  });
}
