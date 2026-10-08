import { constrainWallAngles } from "./wall-constraints";
import { automaticDimensions, type Dimension } from "./dimensions";
import { detectRooms, distance, fitOpening, lerp, project, samePoint, wallFaceGeometry } from "./geometry";
import { parsePlan, type Opening, type Plan, type Point, type Wall } from "./model";

export type FixedDimensionEnd = "start" | "end";
const EPS = 0.02;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const add = (p: Point, d: Point) => ({ x: p.x + d.x, y: p.y + d.y });
const subtract = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a: Point, b: Point) => { const length = distance(a, b); return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }; };

// Give both faces of a room the same start/end convention: left to right,
// or top to bottom for primarily vertical measurements.
export function dimensionEnds(dim: Dimension) {
  const u = unit(dim.a, dim.b);
  const reverse = Math.abs(u.x) >= Math.abs(u.y) ? u.x < 0 : u.y < 0;
  return { start: reverse ? dim.b : dim.a, end: reverse ? dim.a : dim.b };
}

function jambAt(plan: Plan, p: Point, direction: Point, suppliedBodies?: Wall[]) {
  const bodies = suppliedBodies ?? (plan.openings.length ? wallFaceGeometry(plan.walls) : []);
  for (const opening of plan.openings) {
    const wall = plan.walls.find(w => w.id === opening.wallId)!;
    const body = bodies.find(w => w.id === wall.id)!;
    const length = distance(wall.a, wall.b), along = unit(wall.a, wall.b);
    if (Math.abs(dot(along, direction)) < 0.9999) continue;
    for (const end of [-1, 1] as const) {
      const point = lerp(body.a, body.b, opening.t + end * opening.width / (2 * length));
      const delta = subtract(p, point);
      if (Math.abs(dot(delta, direction)) < EPS && Math.abs(delta.x * direction.y - delta.y * direction.x) <= wall.thickness / 2 + EPS)
        return { opening, wall, end };
    }
  }
}

export function dimensionOpening(plan: Plan, dim: Dimension, suppliedBodies?: Wall[]) {
  if (dim.openingId) return plan.openings.find(o => o.id === dim.openingId);
  if (!plan.openings.length) return undefined;
  const { start, end } = dimensionEnds(dim), direction = unit(start, end);
  const bodies = suppliedBodies ?? wallFaceGeometry(plan.walls);
  const a = jambAt(plan, start, direction, bodies), b = jambAt(plan, end, direction, bodies);
  return a && a.opening.id === b?.opening.id ? a.opening : undefined;
}

function validateOpening(wall: Wall, opening: Opening, others: Opening[], walls: Wall[]) {
  const t = fitOpening(wall, opening.width, opening.t, others, opening.id, { kind: opening.kind, walls });
  if (t === null || Math.abs(t - opening.t) * distance(wall.a, wall.b) > EPS)
    throw new Error(opening.kind === "opening" ? "This size would move an opening beyond its wall or overlap another opening. Choose a larger span or reposition the opening first." : "This size would move an opening beyond the wall, overlap another opening, or leave less than 4″ between a door or window and an adjacent wall. Choose a larger span or reposition the opening first.");
}

function boundaryAt(plan: Plan, dim: Dimension, p: Point, direction: Point) {
  const rooms = detectRooms(plan.walls), room = dim.roomId ? rooms.find(r => r.id === dim.roomId) : undefined;
  const bodies = new Map(wallFaceGeometry(plan.walls, rooms).map(w => [w.id, w]));
  return plan.walls.filter(w => {
    // Room boundaries omit dangling T partitions. Include their wall faces
    // when locating the endpoint of a newly split interior dimension.
    if (room && !room.wallIds.includes(w.id) && !plan.walls.some(host => room.wallIds.includes(host.id)
      && [w.a, w.b].some(endpoint => project(endpoint, host.a, host.b).distance < EPS))) return false;
    const body = bodies.get(w.id)!;
    const length = distance(body.a, body.b), along = unit(body.a, body.b), delta = subtract(p, body.a);
    const parallel = Math.abs(dot(along, direction));
    const normalDistance = Math.abs(delta.x * along.y - delta.y * along.x);
    const position = dot(delta, along);
    return parallel < 0.9999 && normalDistance <= w.thickness / 2 + EPS && position >= -w.thickness * 2 && position <= length + w.thickness * 2;
  }).sort((a, b) => Math.abs(dot(unit(a.a, a.b), direction)) - Math.abs(dot(unit(b.a, b.b), direction)))[0];
}

function boundaryRun(walls: Wall[], boundary: Wall) {
  const run = [boundary], direction = unit(boundary.a, boundary.b);
  for (let i = 0; i < run.length; i++) for (const wall of walls) {
    if (run.some(w => w.id === wall.id)) continue;
    const parallel = Math.abs(dot(unit(wall.a, wall.b), direction)) > 0.9999;
    if (parallel && [wall.a, wall.b].some(p => project(p, run[i].a, run[i].b).distance < EPS)
      && Math.abs(subtract(wall.a, boundary.a).x * direction.y - subtract(wall.a, boundary.a).y * direction.x) < EPS) run.push(wall);
  }
  return run;
}

function moveAttachedWalls(plan: Plan, movingWalls: Wall[], movingPoint: Point | undefined, displacement: Point) {
  const key = (p: Point) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
  const points = new Map<string, Point>(), locked = new Set<string>();
  for (const wall of plan.walls) for (const p of [wall.a, wall.b]) {
    const moves = movingPoint ? samePoint(p, movingPoint) : movingWalls.some(w => project(p, w.a, w.b).distance < EPS);
    points.set(key(p), moves ? add(p, displacement) : p);
    if (moves) locked.add(key(p));
  }
  const attachments = [...points.keys()].map(id => {
    const original = plan.walls.flatMap(w => [w.a, w.b]).find(p => key(p) === id)!;
    const hosts = plan.walls.filter(w => !samePoint(w.a, original) && !samePoint(w.b, original) && project(original, w.a, w.b).distance < EPS);
    return { id, original, hosts };
  });
  const currentWalls = () => plan.walls.map(w => ({ ...w, a: points.get(key(w.a))!, b: points.get(key(w.b))! }));
  // Follow T junctions when an attached host changes angle. Collinear hosts
  // keep their existing junction positions wherever those still fit.
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    const walls = currentWalls();
    for (const node of attachments) {
      if (locked.has(node.id)) continue;
      const host = node.hosts.find(w => { const next = walls.find(n => n.id === w.id)!; return project(points.get(node.id)!, next.a, next.b).distance > EPS; });
      if (!host) continue;
      const next = walls.find(w => w.id === host.id)!;
      const target = lerp(next.a, next.b, project(node.original, host.a, host.b).t);
      if (distance(points.get(node.id)!, target) > EPS) { points.set(node.id, target); changed = true; }
    }
    if (!changed) break;
  }
  const targets = new Map((movingPoint ? plan.walls.filter(w => project(movingPoint, w.a, w.b).distance < EPS) : movingWalls).map(w => [w.id, add(movingPoint ?? w.a, displacement)]));
  const walls = constrainWallAngles(plan.walls, currentWalls(), targets);
  if (!walls) throw new Error("This size cannot keep the existing 90° wall junctions connected. Choose the other arrow or a different length.");
  if (walls.some(w => distance(w.a, w.b) < 1)) throw new Error("This dimension would collapse a wall. Enter a larger length.");
  for (const node of attachments) for (const host of node.hosts) {
    const next = walls.find(w => w.id === host.id)!;
    if (project(points.get(node.id)!, next.a, next.b).distance > EPS)
      throw new Error("This size would disconnect attached walls. Choose the other arrow or a different length.");
  }
  const openings = plan.openings.map(opening => {
    const old = plan.walls.find(w => w.id === opening.wallId)!, wall = walls.find(w => w.id === old.id)!;
    const da = subtract(wall.a, old.a), db = subtract(wall.b, old.b);
    const center = lerp(old.a, old.b, opening.t);
    const oldDirection = unit(old.a, old.b), average = { x: (da.x + db.x) / 2, y: (da.y + db.y) / 2 };
    const shift = distance(da, db) < EPS ? da : subtract(average, { x: oldDirection.x * dot(average, oldDirection), y: oldDirection.y * dot(average, oldDirection) });
    return { ...opening, t: project(add(center, shift), wall.a, wall.b).t };
  });
  for (const opening of openings) validateOpening(walls.find(w => w.id === opening.wallId)!, opening, openings, walls);
  return { ...plan, walls, openings };
}

export function editDimension(plan: Plan, dimensionId: string, inches: number, fixedEnd: FixedDimensionEnd = "start"): Plan {
  if (!Number.isFinite(inches) || inches < 1 || inches > 12000) throw new Error("Enter a length between 1 and 12,000 inches.");
  const dim = automaticDimensions(plan).find(d => d.id === dimensionId && !d.hideLabel);
  if (!dim) throw new Error("This dimension has changed. Select it again.");
  const { start, end } = dimensionEnds(dim), direction = unit(start, end);
  const bodies = plan.openings.length ? wallFaceGeometry(plan.walls) : [];
  const startJamb = jambAt(plan, start, direction, bodies), endJamb = jambAt(plan, end, direction, bodies);
  const widthId = dim.openingId ?? (startJamb?.opening.id === endJamb?.opening.id ? startJamb?.opening.id : undefined);
  if (widthId) {
    if (inches < 6 || inches > 240) throw new Error("Opening widths must be between 6 and 240 inches.");
    const opening = plan.openings.find(o => o.id === widthId)!;
    const wall = plan.walls.find(w => w.id === opening.wallId)!;
    const shift = (inches - opening.width) / 2 * (fixedEnd === "start" ? 1 : -1);
    const center = add(lerp(wall.a, wall.b, opening.t), { x: direction.x * shift, y: direction.y * shift });
    const updated = { ...opening, width: inches, t: project(center, wall.a, wall.b).t };
    validateOpening(wall, updated, plan.openings, plan.walls);
    return { ...plan, openings: plan.openings.map(o => o.id === widthId ? updated : o) };
  }
  const moving = fixedEnd === "start" ? end : start, sign = fixedEnd === "start" ? 1 : -1;
  const jamb = fixedEnd === "start" ? endJamb : startJamb;
  const boundary = boundaryAt(plan, dim, moving, direction);
  const run = boundary ? boundaryRun(plan.walls, boundary) : [];
  const endpoint = !boundary && !jamb ? plan.walls.flatMap(w => [w.a, w.b]).find(p => distance(p, moving) < EPS) : undefined;
  if (!jamb && !boundary && !endpoint) throw new Error("The measured endpoint could not be located. Select a wall or opening to adjust it directly.");
  const resize = (delta: number) => {
    const displacement = { x: direction.x * delta * sign, y: direction.y * delta * sign };
    if (jamb) {
      const center = add(lerp(jamb.wall.a, jamb.wall.b, jamb.opening.t), displacement);
      const updated = { ...jamb.opening, t: project(center, jamb.wall.a, jamb.wall.b).t };
      validateOpening(jamb.wall, updated, plan.openings, plan.walls);
      return { ...plan, openings: plan.openings.map(o => o.id === updated.id ? updated : o) };
    }
    return moveAttachedWalls(plan, run, endpoint, displacement);
  };
  // Inside-face offsets can change when attached angled walls rotate. Solve
  // against the regenerated measurement, not just its old centerline span.
  let delta = inches - dim.value, result = plan;
  for (let iteration = 0; iteration < 12; iteration++) {
    result = resize(delta);
    const value = automaticDimensions(result).find(d => d.id === dimensionId)?.value;
    if (value === undefined) throw new Error("This size would collapse or cross a room. Choose a different length.");
    const residual = inches - value;
    if (Math.abs(residual) < 0.005) break;
    const sample = automaticDimensions(resize(delta + 0.1)).find(d => d.id === dimensionId)?.value;
    const slope = sample === undefined ? 0 : (sample - value) / 0.1;
    if (Math.abs(slope) < 0.01) throw new Error("This measurement cannot reach that size by moving the selected end. Choose the other arrow.");
    delta += residual / slope;
  }
  const measured = automaticDimensions(result).find(d => d.id === dimensionId)?.value;
  if (measured === undefined || Math.abs(measured - inches) > 0.02) throw new Error("The walls could not fit that measurement. Choose the other arrow or a different length.");
  const rooms = detectRooms(result.walls);
  if (detectRooms(plan.walls).some(room => !rooms.some(r => r.id === room.id && r.area > 0))) throw new Error("This size would collapse or cross a room. Choose a different length.");
  return parsePlan(result);
}
