import { wallSegments } from "./dimensions";
import { distance, fixtureCorners, wallFaceGeometry } from "./geometry";
import type { Fixture, Plan, Point } from "./model";

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const EPS = 1e-6;

// Wall-face magnets take precedence over the grid. The grid still controls
// motion along a wall, and away from walls the normal grid position is kept.
export function snapFixtureToWalls(fixture: Fixture, plan: Pick<Plan, "walls" | "openings">, tolerance: number, fallback: Point = fixture): Point {
  const angle = fixture.rotation * Math.PI / 180;
  const axes = [{ x: Math.cos(angle), y: Math.sin(angle) }, { x: -Math.sin(angle), y: Math.cos(angle) }];
  const support = (axis: Point) => Math.abs(dot(axis, axes[0])) * fixture.width / 2 + Math.abs(dot(axis, axes[1])) * fixture.depth / 2;
  const bodies = wallFaceGeometry(plan.walls).flatMap(wall => wallSegments(wall, plan).map(segment => {
    const length = distance(segment.a, segment.b);
    const u = { x: (segment.b.x - segment.a.x) / length, y: (segment.b.y - segment.a.y) / length };
    return { a: segment.a, length, u, n: { x: -u.y, y: u.x }, half: wall.thickness / 2 };
  }));
  const contacts = bodies.flatMap(body => {
    const relative = { x: fixture.x - body.a.x, y: fixture.y - body.a.y };
    const along = dot(relative, body.u), extent = support(body.u);
    if (along + extent <= 0 || along - extent >= body.length) return [];
    const signed = dot(relative, body.n), side = signed < 0 ? -1 : 1;
    const value = dot(body.a, body.n) + side * (body.half + support(body.n));
    return Math.abs(dot(fixture, body.n) - value) <= tolerance ? [{ n: body.n, value, body }] : [];
  });
  if (!contacts.length) return { x: fallback.x, y: fallback.y };

  const clear = (point: Point) => {
    const corners = fixtureCorners({ ...fixture, ...point });
    return bodies.every(body => {
      const center = { x: body.a.x + body.u.x * body.length / 2, y: body.a.y + body.u.y * body.length / 2 };
      // Separating axes distinguish real penetration from touching faces,
      // including rotated fixtures, finite wall ends, and angled walls.
      return [...axes, body.u, body.n].some(axis => {
        const values = corners.map(p => dot(p, axis));
        const middle = dot(center, axis), extent = Math.abs(dot(body.u, axis)) * body.length / 2 + Math.abs(dot(body.n, axis)) * body.half;
        return Math.max(...values) <= middle - extent + EPS || Math.min(...values) >= middle + extent - EPS;
      });
    });
  };
  const candidates: { point: Point; count: number }[] = [];
  for (let i = 0; i < contacts.length; i++) {
    const a = contacts[i], delta = a.value - dot(fallback, a.n);
    candidates.push({ point: { x: fallback.x + a.n.x * delta, y: fallback.y + a.n.y * delta }, count: 1 });
    for (let j = i + 1; j < contacts.length; j++) {
      const b = contacts[j], determinant = a.n.x * b.n.y - a.n.y * b.n.x;
      if (Math.abs(determinant) < EPS) continue;
      const point = { x: (a.value * b.n.y - a.n.y * b.value) / determinant, y: (a.n.x * b.value - a.value * b.n.x) / determinant };
      if (distance(point, fixture) <= tolerance * Math.SQRT2 + EPS) candidates.push({ point, count: 2 });
    }
  }
  const candidate = candidates.map(candidate => ({ ...candidate, count: contacts.filter(contact => {
    const along = dot({ x: candidate.point.x - contact.body.a.x, y: candidate.point.y - contact.body.a.y }, contact.body.u);
    const extent = support(contact.body.u);
    return Math.abs(dot(candidate.point, contact.n) - contact.value) < EPS && along + extent > EPS && along - extent < contact.body.length - EPS;
  }).length })).filter(c => c.count && clear(c.point)).sort((a, b) => b.count - a.count || distance(a.point, fixture) - distance(b.point, fixture))[0];
  return candidate?.point ?? { x: fallback.x, y: fallback.y };
}
