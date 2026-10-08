import { SkeletonBuilder } from "straight-skeleton";
import { distance, lerp, pointInPolygon, polygonArea, polygonCenter, project, roofPolygons, samePoint } from "./geometry";
import type { Plan, Point, RoofType } from "./model";

export type RoofLine = { a: Point; b: Point; kind: "ridge" | "hip" | "valley" };
export type RoofFace = { points: Point[]; eave: [Point, Point] };
export type RoofLayout = { perimeter: Point[]; faces: RoofFace[]; lines: RoofLine[]; error?: string };
const key = (p: Point) => `${Math.round(p.x * 10000)},${Math.round(p.y * 10000)}`;
const subtract = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });

function cleanPolygon(points: Point[]): Point[] {
  let poly = points.filter((p, i) => !samePoint(p, points[(i + 1) % points.length]));
  let changed = true;
  while (changed && poly.length > 3) {
    changed = false;
    for (let i = 0; i < poly.length; i++) if (project(poly[i], poly[(i + poly.length - 1) % poly.length], poly[(i + 1) % poly.length]).distance < 0.001) {
      poly = poly.filter((_, j) => i !== j); changed = true; break;
    }
  }
  if (polygonArea(poly) < 0) poly.reverse();
  // A stable starting corner also stabilizes automatic gable orientation on squares.
  const first = poly.reduce((best, p, i) => p.x < poly[best].x - 0.001 || Math.abs(p.x - poly[best].x) < 0.001 && p.y < poly[best].y ? i : best, 0);
  return [...poly.slice(first), ...poly.slice(0, first)];
}

function rectangularGable(perimeter: Point[]): RoofLayout | null {
  if (perimeter.length !== 4) return null;
  const edges = perimeter.map((p, i) => subtract(perimeter[(i + 1) % 4], p));
  if (!edges.every((e, i) => Math.abs(e.x * edges[(i + 1) % 4].x + e.y * edges[(i + 1) % 4].y) < 0.00001 * Math.hypot(e.x, e.y) * Math.hypot(edges[(i + 1) % 4].x, edges[(i + 1) % 4].y))) return null;
  const firstLength = distance(perimeter[0], perimeter[1]), secondLength = distance(perimeter[1], perimeter[2]);
  const start = firstLength > secondLength + 0.001 || Math.abs(firstLength - secondLength) < 0.001 && Math.abs(edges[0].x) >= Math.abs(edges[1].x) ? 0 : 1;
  const [a, b, c, d] = [0, 1, 2, 3].map(i => perimeter[(start + i) % 4]);
  const left = lerp(a, d, 0.5), right = lerp(b, c, 0.5);
  return { perimeter, lines: [{ a: left, b: right, kind: "ridge" }], faces: [
    { points: [a, b, right, left], eave: [a, b] },
    { points: [c, d, left, right], eave: [c, d] },
  ] };
}

function insideOrBoundary(point: Point, perimeter: Point[]) {
  return pointInPolygon(point, perimeter) || perimeter.some((p, i) => project(point, p, perimeter[(i + 1) % perimeter.length]).distance < 0.01);
}

// Equal-speed inward edge propagation produces hip roof planes, including
// split events at reentrant corners. Gables replace triangular end planes by
// extending their ridge junctions to the midpoint of the corresponding end.
// See Laycock & Day, "Automatically Generating Roof Models from Building Footprints".
export function roofForPolygon(points: Point[], type: RoofType): RoofLayout {
  const perimeter = cleanPolygon(points);
  if (type === "gable") {
    const rectangle = rectangularGable(perimeter);
    if (rectangle) return rectangle;
  }
  try {
    const skeleton = SkeletonBuilder.BuildFromGeoJSON([[perimeter.map(p => [p.x, p.y])]]);
    let faces: RoofFace[] = Array.from(skeleton.Edges, edge => ({
      points: Array.from(edge.Polygon, p => ({ x: p.X, y: p.Y })),
      eave: [{ x: edge.Edge.Begin.X, y: edge.Edge.Begin.Y }, { x: edge.Edge.End.X, y: edge.Edge.End.Y }],
    }));
    const gableJunctions = new Set<string>();
    if (type === "gable") {
      const moves = new Map<string, Point>();
      const ends = faces.filter(face => face.points.length === 3 && face.points.some(p => !perimeter.some(c => samePoint(p, c))))
        .sort((a, b) => distance(...a.eave) - distance(...b.eave) || key(a.eave[0]).localeCompare(key(b.eave[0])));
      for (const face of ends) {
        const apex = face.points.find(p => !perimeter.some(c => samePoint(p, c)))!;
        if (moves.has(key(apex))) continue;
        const midpoint = lerp(...face.eave, 0.5);
        // Extending a ridge must remain inside the actual concave footprint.
        const adjacent = faces.filter(f => f.points.some(p => samePoint(p, apex)));
        if (adjacent.every(f => f.points.every(p => [0.25, 0.5, 0.75].every(t => insideOrBoundary(lerp(midpoint, p, t), perimeter))))) {
          moves.set(key(apex), midpoint); gableJunctions.add(key(midpoint));
        }
      }
      faces = faces.map(face => ({ ...face, points: face.points.map(p => moves.get(key(p)) ?? p) }))
        .filter(face => Math.abs(polygonArea(face.points)) > 0.01);
    }
    const segments = new Map<string, { a: Point; b: Point; faces: RoofFace[] }>();
    for (const face of faces) for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i], b = face.points[(i + 1) % face.points.length];
      if (distance(a, b) < 0.01) continue;
      // Ignore eaves and the vertical gable end planes.
      if (perimeter.some((p, i) => project(a, p, perimeter[(i + 1) % perimeter.length]).distance < 0.01 && project(b, p, perimeter[(i + 1) % perimeter.length]).distance < 0.01)) continue;
      const segmentKey = [key(a), key(b)].sort().join("|");
      const segment = segments.get(segmentKey);
      if (segment) segment.faces.push(face);
      else segments.set(segmentKey, { a, b, faces: [face] });
    }
    const lines: RoofLine[] = Array.from(segments.values(), segment => {
      const { a, b } = segment, mid = lerp(a, b, 0.5), span = distance(a, b);
      const normal = { x: -(b.y - a.y) / span, y: (b.x - a.x) / span };
      // Both adjacent slopes rise away from a valley; they fall away from a hip
      // or ridge. This also recognizes valley continuations after split events.
      const valley = segment.faces.length === 2 && segment.faces.every(face => {
        const edge = subtract(face.eave[1], face.eave[0]), length = Math.hypot(edge.x, edge.y);
        const inward = { x: -edge.y / length, y: edge.x / length };
        const towardFace = subtract(polygonCenter(face.points), mid);
        return (inward.x * normal.x + inward.y * normal.y) * Math.sign(towardFace.x * normal.x + towardFace.y * normal.y) > 0.00001;
      });
      const boundary = !gableJunctions.has(key(a)) && !gableJunctions.has(key(b)) && perimeter.some(p => samePoint(p, a) || samePoint(p, b));
      return { a, b, kind: valley ? "valley" : boundary ? "hip" : "ridge" };
    });
    if (!lines.length || faces.some(face => face.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) || lines.some(line => [0.25, 0.5, 0.75].some(t => !insideOrBoundary(lerp(line.a, line.b, t), perimeter)))) throw new Error("Invalid roof geometry");
    return { perimeter, faces, lines };
  } catch {
    return { perimeter, faces: [], lines: [], error: "Roof layout unavailable. Check exterior wall connections and narrow corners." };
  }
}

// Rendering, status, and export share the most recent result for each wall array.
const cache = new WeakMap<Plan["walls"], { settings: string; roofs: RoofLayout[] }>();
export function roofLayouts(plan: Plan): RoofLayout[] {
  const settings = `${plan.roofOverhang}:${plan.roofType ?? "gable"}`;
  const previous = cache.get(plan.walls);
  if (previous?.settings === settings) return previous.roofs;
  const roofs = roofPolygons(plan).map(points => roofForPolygon(points, plan.roofType ?? "gable"));
  cache.set(plan.walls, { settings, roofs });
  return roofs;
}
