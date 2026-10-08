// All model coordinates and sizes are inches. Screen pixels never enter saved plans.
export type Point = { x: number; y: number };
export type Wall = { id: string; a: Point; b: Point; kind: "exterior" | "interior"; thickness: number };
export type Opening = { id: string; wallId: string; kind: "door" | "window" | "opening"; t: number; width: number; flip: boolean; hinge?: "left" | "right" };
export type Fixture = { id: string; catalogId: string; x: number; y: number; width: number; depth: number; rotation: number; steps?: number };
export const DEFAULT_STAIR_STEPS = 12;
export const MAX_STAIR_STEPS = 100;
export type Utility = { id: string; kind: "electrical" | "cold" | "hot" | "drain"; a: Point; b: Point };
export type TextNote = { id: string; x: number; y: number; width: number; fontSize: number; text: string; border: boolean };
export type Finish = "none" | "wood" | "tile" | "carpet" | "vinyl" | "concrete";
export type RoomInfo = { name: string; finish: Finish };
export type RoofType = "gable" | "hip";
export type Plan = {
  version: 1; id: string; name: string; updatedAt: number;
  walls: Wall[]; openings: Opening[]; fixtures: Fixture[]; utilities: Utility[]; notes: TextNote[];
  rooms: Record<string, RoomInfo>; roofOverhang: number; roofType: RoofType;
};
export type Selection = { type: "wall" | "opening" | "fixture" | "utility" | "room" | "text"; id: string };
export type Tool = "select" | "pan" | "exterior" | "interior" | "rectangle" | "door" | "window" | "opening" | "stairs" | "fixture" | "text" | Utility["kind"];
export type Layers = { grid: boolean; dimensions: boolean; roof: boolean; fixtures: boolean; utilities: boolean; finishes: boolean; labels: boolean; notes: boolean };
export const DEFAULT_LAYERS: Layers = { grid: true, dimensions: true, roof: true, fixtures: true, utilities: true, finishes: false, labels: true, notes: true };
export const FINISHES: { id: Finish; name: string; color: string }[] = [
  { id: "none", name: "Unfinished", color: "#fafaf6" },
  { id: "wood", name: "Oak flooring", color: "#e2ccb0" },
  { id: "tile", name: "Ceramic tile", color: "#d9e5e2" },
  { id: "carpet", name: "Carpet", color: "#dcd7ce" },
  { id: "vinyl", name: "Vinyl plank", color: "#d7d5c6" },
  { id: "concrete", name: "Concrete", color: "#d9dcdd" },
];
export const id = () => crypto.randomUUID();
export function blankPlan(name = "Untitled floor plan", draftId: string = id()): Plan {
  return { version: 1, id: draftId, name, updatedAt: Date.now(), walls: [], openings: [], fixtures: [], utilities: [], notes: [], rooms: {}, roofOverhang: 18, roofType: "hip" };
}
export function formatLength(inches: number): string {
  const eighths = Math.round(Math.abs(inches) * 8);
  const feet = Math.floor(eighths / 96);
  const whole = Math.floor((eighths % 96) / 8);
  const fraction = eighths % 8;
  const fractions = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
  return `${feet}′ ${whole}${fractions[fraction]}″`;
}
export function starterPlan(): Plan {
  const p = blankPlan("Accessible home · concept plan");
  const wall = (key: string, a: Point, b: Point, kind: Wall["kind"] = "exterior"): Wall => ({ id: key, a, b, kind, thickness: kind === "exterior" ? 6 : 4.5 });
  p.walls = [
    wall("north", { x: 0, y: 0 }, { x: 480, y: 0 }),
    wall("east", { x: 480, y: 0 }, { x: 480, y: 360 }),
    wall("south", { x: 480, y: 360 }, { x: 0, y: 360 }),
    wall("west", { x: 0, y: 360 }, { x: 0, y: 0 }),
    wall("partition", { x: 288, y: 0 }, { x: 288, y: 360 }, "interior"),
    wall("bed-bath", { x: 288, y: 216 }, { x: 480, y: 216 }, "interior"),
    wall("bath-utility", { x: 408, y: 216 }, { x: 408, y: 360 }, "interior"),
  ];
  p.openings = [
    { id: id(), wallId: "south", kind: "door", t: 0.7, width: 42, flip: true },
    { id: id(), wallId: "partition", kind: "door", t: 0.44, width: 36, flip: false },
    { id: id(), wallId: "partition", kind: "door", t: 0.81, width: 36, flip: false },
    { id: id(), wallId: "bath-utility", kind: "door", t: 0.7, width: 32, flip: false },
    { id: id(), wallId: "north", kind: "window", t: 0.3, width: 72, flip: false },
    { id: id(), wallId: "north", kind: "window", t: 0.8, width: 60, flip: false },
    { id: id(), wallId: "west", kind: "window", t: 0.45, width: 60, flip: false },
    { id: id(), wallId: "east", kind: "window", t: 0.27, width: 48, flip: false },
  ];
  const fixture = (catalogId: string, x: number, y: number, width: number, depth: number, rotation = 0): Fixture => ({ id: id(), catalogId, x, y, width, depth, rotation });
  p.fixtures = [
    fixture("sofa", 64, 146, 84, 36, 90), fixture("coffee-table", 128, 146, 48, 24, 90),
    fixture("dining-table", 185, 245, 60, 36), fixture("chair", 185, 208, 20, 20), fixture("chair", 185, 282, 20, 20, 180),
    fixture("counter", 88, 18, 144, 24), fixture("sink", 83, 18, 30, 22), fixture("range", 158, 19, 30, 28),
    fixture("fridge", 242, 24, 36, 36), fixture("queen-bed", 387, 68, 60, 80),
    fixture("nightstand", 336, 30, 20, 20), fixture("nightstand", 438, 30, 20, 20),
    fixture("shower", 317, 244, 48, 48), fixture("toilet", 381, 240, 20, 30), fixture("vanity", 347, 341, 42, 24, 180),
    fixture("washer", 445, 241, 27, 30), fixture("dryer", 445, 278, 27, 30),
    fixture("outlet", 245, 8, 8, 8), fixture("switch", 280, 270, 8, 8),
    fixture("light", 183, 145, 12, 12), fixture("light", 385, 148, 12, 12),
  ];
  return p;
}

// Imports are untrusted. Validate every editable numeric field before geometry/rendering.
export function parsePlan(value: unknown): Plan {
  const fail = (): never => { throw new Error("This file is not a valid SAH floor plan."); };
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const str = (v: unknown, max = 160): string => typeof v === "string" && v.length > 0 && v.length <= max ? v : fail();
  const num = (v: unknown, min = -120000, max = 120000): number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail();
  const point = (v: unknown): Point => { const o = obj(v); return { x: num(o.x), y: num(o.y) }; };
  const arr = <T>(v: unknown, parser: (o: Record<string, unknown>) => T, max = 500): T[] => Array.isArray(v) && v.length <= max ? v.map(x => parser(obj(x))) : fail();
  const p = obj(value);
  if (p.version !== 1) fail();
  if (p.roofType !== undefined && p.roofType !== "gable" && p.roofType !== "hip") fail();
  const walls = arr(p.walls, w => {
    if (w.kind !== "exterior" && w.kind !== "interior") fail();
    const a = point(w.a), b = point(w.b);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) fail();
    return { id: str(w.id), a, b, kind: w.kind as Wall["kind"], thickness: num(w.thickness, 1, 24) };
  });
  const wallIds = new Set(walls.map(w => w.id));
  const openings = arr(p.openings, o => {
    if ((o.kind !== "door" && o.kind !== "window" && o.kind !== "opening") || !wallIds.has(String(o.wallId)) || typeof o.flip !== "boolean") fail();
    if (o.hinge !== undefined && o.hinge !== "left" && o.hinge !== "right") fail();
    return { id: str(o.id), wallId: str(o.wallId), kind: o.kind as Opening["kind"], t: num(o.t, 0, 1), width: num(o.width, 6, 240), flip: o.flip as boolean,
      ...(o.hinge === undefined ? {} : { hinge: o.hinge as Opening["hinge"] }) };
  });
  for (let i = 0; i < openings.length; i++) {
    const o = openings[i], w = walls.find(w => w.id === o.wallId)!;
    const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (o.t * length - o.width / 2 < -0.01 || o.t * length + o.width / 2 > length + 0.01) fail();
    if (openings.slice(0, i).some(other => other.wallId === o.wallId && Math.abs(other.t - o.t) * length < (other.width + o.width) / 2 - 0.01)) fail();
  }
  const fixtures = arr(p.fixtures, f => {
    const steps = f.steps === undefined ? (f.catalogId === "stairs" ? DEFAULT_STAIR_STEPS : undefined) : f.steps;
    if (steps !== undefined && (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1 || steps > MAX_STAIR_STEPS)) fail();
    return { id: str(f.id), catalogId: str(f.catalogId), x: num(f.x), y: num(f.y), width: num(f.width, 1, 600), depth: num(f.depth, 1, 600), rotation: num(f.rotation, -3600, 3600), ...(steps === undefined ? {} : { steps: steps as number }) };
  }, 1000);
  const utilities = arr(p.utilities, u => {
    if (!["electrical", "cold", "hot", "drain"].includes(String(u.kind))) fail();
    return { id: str(u.id), kind: u.kind as Utility["kind"], a: point(u.a), b: point(u.b) };
  });
  const notes = p.notes === undefined ? [] : arr(p.notes, n => {
    if (typeof n.text !== "string" || n.text.length > 2000 || typeof n.border !== "boolean") fail();
    return { id: str(n.id), x: num(n.x), y: num(n.y), width: num(n.width, 48, 2400), fontSize: num(n.fontSize, 4, 24), text: n.text as string, border: n.border as boolean };
  }, 100);
  const allIds = [...walls, ...openings, ...fixtures, ...utilities, ...notes].map(o => o.id);
  if (new Set(allIds).size !== allIds.length) fail();
  const rooms: Record<string, RoomInfo> = Object.create(null);
  const rawRooms = obj(p.rooms);
  if (Object.keys(rawRooms).length > 500) fail();
  for (const [key, val] of Object.entries(rawRooms)) {
    const r = obj(val);
    if (!FINISHES.some(f => f.id === r.finish)) fail();
    rooms[str(key, 100000)] = { name: str(r.name, 80), finish: r.finish as Finish };
  }
  return { version: 1, id: str(p.id), name: str(p.name), updatedAt: num(p.updatedAt, 0, Number.MAX_SAFE_INTEGER), walls, openings, fixtures, utilities, notes, rooms, roofOverhang: num(p.roofOverhang, 0, 72), roofType: p.roofType as RoofType | undefined ?? "gable" };
}
