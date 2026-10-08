import type { Point, Wall } from "./model";

const EPS = .01;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const minus = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const length = (p: Point) => Math.hypot(p.x, p.y);
const key = (p: Point) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
function onWall(p: Point, w: Wall) {
  const delta = minus(w.b, w.a), size = length(delta), offset = minus(p, w.a);
  const along = dot(offset, delta) / size;
  return size > EPS && along >= -EPS && along <= size + EPS && Math.abs(offset.x * delta.y - offset.y * delta.x) / size < EPS;
}
function direction(w: Wall) {
  const d = minus(w.b, w.a), size = length(d);
  return { x: d.x / size, y: d.y / size };
}
function meet(a: Wall, b: Wall) {
  if ([a.a, a.b].some(p => onWall(p, b)) || [b.a, b.b].some(p => onWall(p, a))) return true;
  const r = minus(a.b, a.a), s = minus(b.b, b.a), den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-8) return false;
  const d = minus(b.a, a.a), t = (d.x * s.y - d.y * s.x) / den, u = (d.x * r.y - d.y * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function wallPointTargets(walls: Wall[], wallId: string, end: "a" | "b", to: Point) {
  const wall = walls.find(w => w.id === wallId);
  return new Map(wall ? walls.filter(w => w.id === wallId || onWall(wall[end], w)).map(w => [w.id, to]) : []);
}

type Line = { n: Point; value: number };
type Node = { id: string; old: Point; index: number; end: "a" | "b"; hosts: number[]; groups: number[] };
type Layout = { snapshot: { id: string; a: Point; b: Point }[]; directions: Point[]; groups: number[]; lines: Map<number, Line>; nodes: Node[] };
const layouts = new WeakMap<Wall[], Layout>();

function wallLayout(walls: Wall[]): Layout {
  const cached = layouts.get(walls);
  if (cached && cached.snapshot.length === walls.length && cached.snapshot.every((w, i) => w.id === walls[i].id && w.a.x === walls[i].a.x && w.a.y === walls[i].a.y && w.b.x === walls[i].b.x && w.b.y === walls[i].b.y)) return cached;
  const directions = walls.map(direction), locked = new Set<number>(), groups = walls.map((_, i) => i);
  const root = (i: number): number => groups[i] === i ? i : (groups[i] = root(groups[i]));
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const parallel = Math.abs(dot(directions[i], directions[j]));
    if (parallel < 1e-5 && meet(walls[i], walls[j])) { locked.add(i); locked.add(j); }
    // Collinear pieces at T joints share one supporting line.
    if (parallel > 1 - 1e-8 && meet(walls[i], walls[j]) && [walls[j].a, walls[j].b].every(p => Math.abs(dot(minus(p, walls[i].a), { x: -directions[i].y, y: directions[i].x })) < EPS)) groups[root(j)] = root(i);
  }
  for (let i = 0; i < groups.length; i++) groups[i] = root(i);
  const lines = new Map<number, Line>();
  for (const i of locked) {
    const group = groups[i], n = { x: -directions[group].y, y: directions[group].x };
    if (!lines.has(group)) lines.set(group, { n, value: dot(walls[group].a, n) });
  }
  const nodes = new Map<string, Node>();
  for (let i = 0; i < walls.length; i++) for (const end of ["a", "b"] as const) {
    const old = walls[i][end], id = key(old);
    if (nodes.has(id)) continue;
    const hosts = walls.flatMap((w, j) => onWall(old, w) ? [j] : []);
    nodes.set(id, { id, old, index: i, end, hosts, groups: [...new Set(hosts.map(j => groups[j]).filter(group => lines.has(group)))] });
  }
  const layout = { snapshot: walls.map(w => ({ id: w.id, a: { ...w.a }, b: { ...w.b } })), directions, groups, lines, nodes: [...nodes.values()] };
  layouts.set(walls, layout);
  return layout;
}

// Selected supporting lines move; their intersections resize adjoining walls
// without tilting existing square junctions. Unconnected angled walls stay free.
export function constrainWallAngles(before: Wall[], proposed: Wall[], targets: Map<string, Point>): Wall[] | null {
  if (!targets.size) return proposed;
  const layout = wallLayout(before);
  if (!layout.lines.size) return proposed;
  const lines = new Map(layout.lines), driven = new Map<number, Point[]>();
  for (let i = 0; i < before.length; i++) {
    const point = targets.get(before[i].id), group = layout.groups[i];
    if (point && lines.has(group)) driven.set(group, [...(driven.get(group) ?? []), point]);
  }
  for (const [group, points] of driven) {
    const n = lines.get(group)!.n, value = dot(points[0], n);
    if (points.some(p => Math.abs(dot(p, n) - value) > EPS)) return null;
    lines.set(group, { n, value });
  }
  const points = new Map<string, Point>();
  for (const node of layout.nodes) {
    let next = proposed[node.index][node.end];
    const constraints = node.groups.map(group => lines.get(group)!);
    if (constraints.length) {
      const a = constraints[0], b = constraints.find(line => Math.abs(a.n.x * line.n.y - a.n.y * line.n.x) > 1e-6);
      if (b) {
        const den = a.n.x * b.n.y - a.n.y * b.n.x;
        next = { x: (a.value * b.n.y - a.n.y * b.value) / den, y: (a.n.x * b.value - a.value * b.n.x) / den };
      } else {
        const shift = a.value - dot(next, a.n);
        next = { x: next.x + a.n.x * shift, y: next.y + a.n.y * shift };
      }
      if (constraints.some(line => Math.abs(dot(next, line.n) - line.value) > EPS)) return null;
      next = { x: Math.abs(next.x) < 1e-10 ? 0 : next.x, y: Math.abs(next.y) < 1e-10 ? 0 : next.y };
    }
    points.set(node.id, next);
  }
  const result = proposed.map((w, i) => ({ ...w, a: points.get(key(before[i].a))!, b: points.get(key(before[i].b))! }));
  if (result.some((w, i) => lines.has(layout.groups[i]) && dot(minus(w.b, w.a), layout.directions[i]) < 1)) return null;
  // T endpoints remain on their finite hosts rather than their extensions.
  if (layout.nodes.some(node => node.hosts.some(i => !onWall(points.get(node.id)!, result[i])))) return null;
  return result;
}
