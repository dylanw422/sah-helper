import { detectRooms, distance, project, samePoint, type Room } from "./geometry";
import { id, parsePlan, type Plan, type Point, type SlabEdge, type Wall } from "./model";
import type { Dimension } from "./dimensions";
import { constrainWallAngles } from "./wall-constraints";

export function slabSnapWalls(slabs: SlabEdge[]): Wall[] {
  return slabs.map(edge => ({ ...edge, thickness: 0, kind: "interior" }));
}

export const isSlabArea = (area: Room) => area.id.startsWith("slab-area:");
const spanKey = (a: Point, b: Point) => [a, b].map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort().join(":");
function boundarySpans(plan: Pick<Plan, "slabs">, area: Room) {
  return area.points.flatMap((a, index) => {
    const b = area.points[(index + 1) % area.points.length];
    const slab = plan.slabs.find(edge => project(a, edge.a, edge.b).distance < .01 && project(b, edge.a, edge.b).distance < .01);
    return slab ? [{ slab, a, b, key: spanKey(a, b) }] : [];
  });
}

// Slabs use their own graph: they can close against a wall without becoming
// house walls, rooms, roof geometry, or usable interior floor area.
export function slabAreas(plan: Pick<Plan, "walls" | "slabs">) {
  if (!plan.slabs.length) return [];
  const walls: Wall[] = [
    ...plan.walls.map(w => ({ ...w, id: `wall:${w.id}`, thickness: 0, kind: "interior" as const })),
    ...slabSnapWalls(plan.slabs).map(s => ({ ...s, id: `slab:${s.id}` })),
  ];
  const measured = new Set<string>();
  return detectRooms(walls, .5)
    .filter(room => room.wallIds.some(key => key.startsWith("slab:")))
    .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id))
    .filter(room => {
      // When a slab divides an existing room, label the enclosed pad rather
      // than also labeling the leftover room on the other side of its edges.
      const spans = boundarySpans(plan, room);
      if (spans.every(span => measured.has(span.key))) return false;
      for (const span of spans) measured.add(span.key);
      return true;
    })
    .map(room => ({ ...room, id: `slab-area:${room.id}` }))
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
}

export function slabDimensions(plan: Pick<Plan, "walls" | "slabs">): Dimension[] {
  const measured = new Set<string>();
  // A slab drawn within an existing enclosure has a face on both sides.
  // Measure each physical span once, facing away from the smaller area.
  return slabAreas(plan).sort((a, b) => a.area - b.area).flatMap(area => boundarySpans(plan, area).flatMap(({ slab, a, b, key }) => {
    if (measured.has(key)) return [];
    measured.add(key);
    return [{ id: `slab:${slab.id}:span:${key}`, slabId: slab.id, a, b, value: distance(a, b), offset: -30 }];
  }));
}

export function addSlabEdges(plan: Plan, points: Point[], closed = false): Plan {
  const ends = closed ? [...points.slice(1), points[0]] : points.slice(1);
  if (plan.slabs.length + ends.length > 500) throw new Error("This plan has reached the 500-slab-edge limit.");
  const edges = ends.map((b, i) => ({ id: id(), a: points[i], b }));
  if (edges.some(edge => distance(edge.a, edge.b) < 1)) throw new Error("Slab edges must be at least 1 inch long.");
  if (edges.some(edge => plan.slabs.some(old => project(edge.a, old.a, old.b).distance < .01 && project(edge.b, old.a, old.b).distance < .01)))
    throw new Error("A slab edge already exists along this segment.");
  return parsePlan({ ...plan, slabs: [...plan.slabs, ...edges] });
}

export function moveSlabPoints(plan: Plan, moves: { from: Point; to: Point }[]): Plan {
  const move = (point: Point) => moves.find(change => samePoint(change.from, point))?.to ?? point;
  const before = slabSnapWalls(plan.slabs), proposed = before.map(edge => ({ ...edge, a: move(edge.a), b: move(edge.b) }));
  const targets = new Map(before.flatMap(edge => {
    const change = moves.find(change => samePoint(change.from, edge.a) || samePoint(change.from, edge.b));
    return change ? [[edge.id, change.to] as const] : [];
  }));
  const fitted = constrainWallAngles(before, proposed, targets);
  if (!fitted || fitted.some(edge => distance(edge.a, edge.b) < 1)) throw new Error("This move would collapse a slab edge. Choose a different position.");
  const slabs = fitted.map(({ id, a, b }) => ({ id, a, b }));
  return parsePlan({ ...plan, slabs });
}

export function moveSlabEdge(plan: Plan, edgeId: string, delta: Point): Plan {
  const edge = plan.slabs.find(s => s.id === edgeId);
  return edge ? moveSlabPoints(plan, [edge.a, edge.b].map(from => ({ from, to: { x: from.x + delta.x, y: from.y + delta.y } }))) : plan;
}
