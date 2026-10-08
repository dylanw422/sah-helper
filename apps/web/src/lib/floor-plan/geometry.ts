import type { Fixture, Opening, Plan, Point, Wall } from "./model";
import { constrainWallAngles, wallPointTargets } from "./wall-constraints";
import { noteCorners } from "./notes";

export const EPS = 0.01;
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const samePoint = (a: Point, b: Point) => distance(a, b) < EPS;
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export function project(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  const point = lerp(a, b, t);
  return { point, t, distance: distance(p, point) };
}
export function bounds(points: Point[]) {
  if (!points.length) return { x: -120, y: -120, width: 720, height: 600 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}
export function fixtureCorners(f: Fixture): Point[] {
  const angle = f.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: f.x + x * f.width / 2 * c - y * f.depth / 2 * s, y: f.y + x * f.width / 2 * s + y * f.depth / 2 * c }));
}
export function planBounds(plan: Plan) {
  return bounds([...plan.walls.flatMap(w => [w.a, w.b]), ...plan.fixtures.flatMap(fixtureCorners), ...plan.utilities.flatMap(u => [u.a, u.b]), ...plan.notes.flatMap(noteCorners)]);
}
export function polygonArea(points: Point[]) {
  return points.reduce((s, p, i) => s + cross(p, points[(i + 1) % points.length]), 0) / 2;
}
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function polygonCenter(poly: Point[]): Point {
  const area = polygonArea(poly);
  if (Math.abs(area) < EPS) return poly[0];
  let x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = cross(a, b);
    x += (a.x + b.x) * c; y += (a.y + b.y) * c;
  }
  const center = { x: x / (6 * area), y: y / (6 * area) };
  if (pointInPolygon(center, poly)) return center;
  // A concave room's centroid may be outside: choose the midpoint of its widest scanline.
  const box = bounds(poly);
  let best = poly[0], span = 0;
  for (let n = 1; n < 10; n++) {
    const py = box.y + box.height * n / 10;
    const hits: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y > py) !== (b.y > py)) hits.push(a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] > span) { span = hits[i + 1] - hits[i]; best = { x: (hits[i + 1] + hits[i]) / 2, y: py }; }
  }
  return best;
}
function intersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const ca = { x: c.x - a.x, y: c.y - a.y }, t = cross(ca, s) / denom, u = cross(ca, r) / denom;
  return t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8 ? lerp(a, b, t) : null;
}
export type Room = { id: string; points: Point[]; inner: Point[]; wallIds: string[]; area: number; center: Point };

// Build a planar graph, including T junctions, crossing walls and collinear splits.
// Walking directed edges extracts bounded faces instead of guessing from a bounding box.
export function detectRooms(walls: Wall[]): Room[] {
  const active = walls.filter(w => distance(w.a, w.b) >= 0.5);
  const splits = active.map(w => [w.a, w.b]);
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j], hit = intersection(a.a, a.b, b.a, b.b);
    if (hit) { splits[i].push(hit); splits[j].push(hit); }
    for (const p of [b.a, b.b]) if (project(p, a.a, a.b).distance < EPS) splits[i].push(p);
    for (const p of [a.a, a.b]) if (project(p, b.a, b.b).distance < EPS) splits[j].push(p);
  }
  type Edge = { to: string; wall: Wall; angle: number };
  const nodes = new Map<string, { point: Point; edges: Edge[] }>();
  const key = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  for (let i = 0; i < active.length; i++) {
    const w = active[i];
    const ps = [...new Map(splits[i].map(p => [key(p), p])).values()].sort((a, b) => project(a, w.a, w.b).t - project(b, w.a, w.b).t);
    for (let j = 0; j < ps.length - 1; j++) {
      const a = ps[j], b = ps[j + 1], ak = key(a), bk = key(b);
      if (ak === bk) continue;
      if (!nodes.has(ak)) nodes.set(ak, { point: a, edges: [] });
      if (!nodes.has(bk)) nodes.set(bk, { point: b, edges: [] });
      if (!nodes.get(ak)!.edges.some(e => e.to === bk)) {
        nodes.get(ak)!.edges.push({ to: bk, wall: w, angle: Math.atan2(b.y - a.y, b.x - a.x) });
        nodes.get(bk)!.edges.push({ to: ak, wall: w, angle: Math.atan2(a.y - b.y, a.x - b.x) });
      }
    }
  }
  for (const node of nodes.values()) node.edges.sort((a, b) => a.angle - b.angle);
  const visited = new Set<string>(), rooms: Room[] = [];
  for (const [start, node] of nodes) for (const first of node.edges) {
    if (visited.has(`${start}>${first.to}`)) continue;
    let from = start, edge = first;
    const points: Point[] = [], faceWalls: Wall[] = [];
    let closed = false;
    for (let n = 0; n <= nodes.size * 4; n++) {
      const edgeKey = `${from}>${edge.to}`;
      if (visited.has(edgeKey)) { closed = from === start && edge.to === first.to; break; }
      visited.add(edgeKey); points.push(nodes.get(from)!.point); faceWalls.push(edge.wall);
      const next = nodes.get(edge.to)!;
      const reverse = next.edges.findIndex(e => e.to === from);
      from = edge.to; edge = next.edges[(reverse - 1 + next.edges.length) % next.edges.length];
    }
    if (!closed || points.length < 3 || polygonArea(points) <= 144) continue;
    // Remove dangling walls traversed in both directions from a face boundary.
    let changed = true;
    while (changed && points.length >= 3) {
      changed = false;
      for (let i = 0; i < points.length; i++) if (samePoint(points[i], points[(i + 2) % points.length])) {
        const j = (i + 1) % points.length;
        if (j < i) { points.splice(i, 1); faceWalls.splice(i, 1); points.splice(j, 1); faceWalls.splice(j, 1); }
        else { points.splice(i, 2); faceWalls.splice(i, 2); }
        changed = true; break;
      }
    }
    if (points.length < 3) continue;
    const inner = offsetPolygon(points, faceWalls.map(w => -w.thickness / 2));
    const wallIds = [...new Set(faceWalls.map(w => w.id))].sort();
    const roomId = wallIds.join("|");
    rooms.push({ id: roomId, points, inner, wallIds, area: Math.max(0, polygonArea(inner) / 144), center: polygonCenter(inner) });
  }
  return rooms.sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
}

// Positive distance expands a clockwise (screen-coordinate) polygon. Miter joins
// retain the actual footprint, including reentrant corners of L-shaped houses.
export function offsetPolygon(poly: Point[], offsets: number | number[]): Point[] {
  const sign = polygonArea(poly) >= 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length], length = distance(p, q);
    const amount = (typeof offsets === "number" ? offsets : offsets[i]) * sign;
    const nx = length ? (q.y - p.y) / length * amount : 0, ny = length ? -(q.x - p.x) / length * amount : 0;
    return { a: { x: p.x + nx, y: p.y + ny }, b: { x: q.x + nx, y: q.y + ny }, amount };
  });
  return lines.map((line, i) => {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const r = { x: prev.b.x - prev.a.x, y: prev.b.y - prev.a.y }, s = { x: line.b.x - line.a.x, y: line.b.y - line.a.y };
    const den = cross(r, s);
    if (Math.abs(den) < EPS) return line.a;
    const t = cross({ x: line.a.x - prev.a.x, y: line.a.y - prev.a.y }, s) / den;
    const hit = { x: prev.a.x + t * r.x, y: prev.a.y + t * r.y };
    // Cap acute miters rather than allowing spikes from nearly parallel walls.
    return distance(hit, poly[i]) <= Math.max(24, Math.abs(line.amount) * 8) ? hit : line.a;
  });
}
export function roofPolygons(plan: Plan) {
  const exterior = plan.walls.filter(w => w.kind === "exterior");
  const byId = new Map(exterior.map(w => [w.id, w]));
  return detectRooms(exterior).map(room => offsetPolygon(room.points, room.points.map((p, i) => {
    const q = room.points[(i + 1) % room.points.length];
    const w = exterior.find(w => project(p, w.a, w.b).distance < EPS && project(q, w.a, w.b).distance < EPS) ?? byId.get(room.wallIds[0]);
    return plan.roofOverhang + (w?.thickness ?? 6) / 2;
  })));
}
export function snapPoint(p: Point, walls: Wall[], grid: number, tolerance: number, origin?: Point, orthogonal = true, exclude: string[] = []): Point {
  const candidates = walls.filter(w => !exclude.includes(w.id));
  let result = { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
  if (origin && orthogonal) {
    const vertical = Math.abs(p.x - origin.x) < Math.abs(p.y - origin.y);
    const fixedAxis = vertical ? "x" : "y", movingAxis = vertical ? "y" : "x";
    result[fixedAxis] = origin[fixedAxis];
    // An endpoint snap must stay on the locked axis. Nearby off-axis corners
    // cannot turn an orthogonal wall into a diagonal.
    const endpoint = candidates.flatMap(w => [w.a, w.b])
      .filter(point => Math.abs(point[fixedAxis] - origin[fixedAxis]) < EPS && distance(point, p) < tolerance)
      .sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (endpoint) return { ...result, [movingAxis]: endpoint[movingAxis] };
    // Meet a host wall at its intersection with the locked drawing line,
    // rather than projecting perpendicularly and breaking the axis lock.
    const intersections: Point[] = [];
    for (const wall of candidates) {
      const delta = wall.b[fixedAxis] - wall.a[fixedAxis];
      if (Math.abs(delta) < EPS) {
        if (Math.abs(wall.a[fixedAxis] - origin[fixedAxis]) < EPS) {
          const hit = project(result, wall.a, wall.b).point;
          intersections.push({ ...hit, [fixedAxis]: origin[fixedAxis] });
        }
        continue;
      }
      const t = (origin[fixedAxis] - wall.a[fixedAxis]) / delta;
      if (t < 0 || t > 1) continue;
      intersections.push({ ...result, [movingAxis]: wall.a[movingAxis] + t * (wall.b[movingAxis] - wall.a[movingAxis]) });
    }
    const closest = intersections.sort((a, b) => distance(a, result) - distance(b, result))[0];
    return closest && distance(closest, result) < tolerance ? closest : result;
  }
  const endpoint = candidates.flatMap(w => [w.a, w.b]).sort((a, b) => distance(a, p) - distance(b, p))[0];
  if (endpoint && distance(endpoint, p) < tolerance) return { ...endpoint };
  const closest = candidates.map(w => project(result, w.a, w.b)).sort((a, b) => a.distance - b.distance)[0];
  if (closest && closest.distance < tolerance) result = closest.point;
  return result;
}
export const OPENING_WALL_CLEARANCE = 4;

// Project the adjacent wall body onto the host, across both faces of the host
// wall. Clipping its finite rectangle also handles angled corners and T joints.
function adjacentWallSpan(host: Wall, other: Wall): [number, number] | null {
  const length = distance(host.a, host.b), otherLength = distance(other.a, other.b);
  if (!length || !otherLength || host.id === other.id) return null;
  const ux = (host.b.x - host.a.x) / length, uy = (host.b.y - host.a.y) / length;
  const vx = (other.b.x - other.a.x) / otherLength, vy = (other.b.y - other.a.y) / otherLength;
  // Collinear wall segments are a continued wall, not a corner obstruction.
  if (Math.abs(ux * vy - uy * vx) < 1e-6) return null;
  const local = (p: Point): Point => ({ x: (p.x - host.a.x) * ux + (p.y - host.a.y) * uy, y: -(p.x - host.a.x) * uy + (p.y - host.a.y) * ux });
  const half = other.thickness / 2;
  let polygon = [
    { x: other.a.x - vy * half, y: other.a.y + vx * half },
    { x: other.b.x - vy * half, y: other.b.y + vx * half },
    { x: other.b.x + vy * half, y: other.b.y - vx * half },
    { x: other.a.x + vy * half, y: other.a.y - vx * half },
  ].map(local);
  for (const sign of [-1, 1]) {
    const clipped: Point[] = [], limit = host.thickness / 2;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const insideA = sign * a.y <= limit, insideB = sign * b.y <= limit;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) clipped.push(lerp(a, b, (sign * limit - a.y) / (b.y - a.y)));
    }
    polygon = clipped;
  }
  return polygon.length ? [Math.min(...polygon.map(p => p.x)), Math.max(...polygon.map(p => p.x))] : null;
}

export function fitOpening(wall: Wall, width: number, t: number, others: Opening[] = [], exclude?: string, context?: { kind: Opening["kind"]; walls: Wall[] }) {
  const length = distance(wall.a, wall.b);
  const clearance = OPENING_WALL_CLEARANCE, half = width / 2;
  if (width + clearance * 2 > length) return null;
  let spans: [number, number][] = [[half + clearance, length - half - clearance]];
  if (context) for (const other of context.walls) {
    const obstruction = adjacentWallSpan(wall, other);
    if (!obstruction) continue;
    const left = obstruction[0] - half - clearance, right = obstruction[1] + half + clearance;
    spans = spans.flatMap(([a, b]): [number, number][] => {
      if (right <= a || left >= b) return [[a, b]];
      const remaining: [number, number][] = [];
      if (left >= a) remaining.push([a, left]);
      if (right <= b) remaining.push([right, b]);
      return remaining;
    });
  }
  if (!spans.length) return null;
  const target = t * length;
  const center = spans.map(([a, b]) => Math.max(a, Math.min(b, target))).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  const pos = center / length;
  if (others.some(o => o.wallId === wall.id && o.id !== exclude && Math.abs(o.t - pos) * length < (o.width + width) / 2 + 1)) return null;
  return pos;
}
export function moveWallPoint(plan: Plan, wallId: string, end: "a" | "b", to: Point): Plan {
  const wall = plan.walls.find(w => w.id === wallId);
  if (!wall) return plan;
  const old = wall[end], a = end === "a" ? to : wall.a, b = end === "b" ? to : wall.b;
  const move = (p: Point) => {
    if (samePoint(p, old)) return to;
    const attachment = project(p, wall.a, wall.b);
    return attachment.distance < EPS ? lerp(a, b, attachment.t) : p;
  };
  const proposed = plan.walls.map(w => ({ ...w, a: move(w.a), b: move(w.b) }));
  const walls = constrainWallAngles(plan.walls, proposed, wallPointTargets(plan.walls, wallId, end, to));
  if (!walls || walls.some(w => distance(w.a, w.b) < 1)) return plan;
  return { ...plan, walls, openings: normalizeOpenings(walls, plan.openings) };
}
export function moveWalls(plan: Plan, wallIds: string[], delta: Point): Plan {
  const selected = plan.walls.filter(w => wallIds.includes(w.id));
  const translate = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  const move = (p: Point) => selected.some(w => project(p, w.a, w.b).distance < EPS) ? translate(p) : p;
  const proposed = plan.walls.map(w => ({ ...w, a: move(w.a), b: move(w.b) }));
  if (proposed.some(w => distance(w.a, w.b) < 1)) return plan;
  const walls = constrainWallAngles(plan.walls, proposed, new Map(selected.map(w => [w.id, translate(lerp(w.a, w.b, .5))])));
  if (!walls || walls.some(w => distance(w.a, w.b) < 1)) return plan;
  return { ...plan, walls, openings: normalizeOpenings(walls, plan.openings) };
}
export function normalizeOpenings(walls: Wall[], openings: Opening[]) {
  const accepted: Opening[] = [];
  for (const o of openings) {
    const w = walls.find(w => w.id === o.wallId);
    if (!w) continue;
    const t = fitOpening(w, o.width, o.t, accepted, undefined, { kind: o.kind, walls });
    if (t !== null) accepted.push({ ...o, t });
  }
  return accepted;
}
export function polygonString(points: Point[]) { return points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" "); }
