import { describe, expect, test } from "bun:test";
import { automaticDimensions, wallSegments } from "../apps/web/src/lib/floor-plan/dimensions";
import { bounds, detectRooms, fitOpening, moveWallPoint, normalizeOpenings, offsetPolygon, pointInPolygon, polygonArea, roofPolygons, snapPoint } from "../apps/web/src/lib/floor-plan/geometry";
import { blankPlan, DEFAULT_LAYERS, formatLength, parsePlan, starterPlan, type Point, type Wall } from "../apps/web/src/lib/floor-plan/model";
import { clientPlanError, planFingerprint } from "../apps/web/src/lib/floor-plan/client-plans";
import { roofForPolygon, roofLayouts } from "../apps/web/src/lib/floor-plan/roof";

import { A4, printBounds, printLayout } from "../apps/web/src/lib/floor-plan/print";
import { noteLayout } from "../apps/web/src/lib/floor-plan/notes";
import { parseLengthInput } from "../apps/web/src/lib/floor-plan/length-input";
import { deleteSelection, moveSelection, selectInBox, selectionBounds, visibleSelections } from "../apps/web/src/lib/floor-plan/selection";
import { dimensionEnds, editDimension } from "../apps/web/src/lib/floor-plan/edit-dimension";

describe("client sync", () => {
  test("timestamps do not mark an unchanged or undone plan as dirty", () => {
    const plan = starterPlan();
    expect(planFingerprint(plan)).toBe(planFingerprint({ ...plan, updatedAt: plan.updatedAt + 5000 }));
    expect(planFingerprint(plan)).toBe(planFingerprint(parsePlan(JSON.parse(JSON.stringify(plan)))));
    expect(planFingerprint(plan)).not.toBe(planFingerprint({ ...plan, name: "Changed name" }));
    expect(planFingerprint(plan)).not.toBe(planFingerprint({ ...plan, fixtures: plan.fixtures.slice(1) }));
    expect(planFingerprint(plan)).not.toBe(planFingerprint({ ...plan, roofOverhang: plan.roofOverhang + 12 }));
  });
  test("conflicts and connectivity errors preserve their actionable message", () => {
    expect(clientPlanError({ data: { code: "CONFLICT", message: "Open the newer saved version." } })).toBe("Open the newer saved version.");
    expect(clientPlanError({ data: "Enter a client name." })).toBe("Enter a client name.");
    expect(clientPlanError(new Error("Connection unavailable"))).toBe("Connection unavailable");
  });
});

const wall = (id: string, a: Point, b: Point, kind: Wall["kind"] = "exterior"): Wall => ({ id, a, b, kind, thickness: 6 });
function rectangle(width = 240, height = 180) {
  const p = blankPlan("Test home");
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  p.walls = corners.map((a, i) => wall(`w${i}`, a, corners[(i + 1) % 4]));
  return p;
}

describe("automatic rooms and inside-face measurements", () => {
  test("a rectangle produces exactly one room with a usable area", () => {
    const rooms = detectRooms(rectangle().walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(234 * 174 / 144);
    expect(rooms[0].center).toEqual({ x: 120, y: 90 });
    expect(bounds(rooms[0].inner)).toEqual({ x: 3, y: 3, width: 234, height: 174 });
  });
  test("open exterior walls produce no room and no roof", () => {
    const p = rectangle(); p.walls.pop();
    expect(detectRooms(p.walls)).toHaveLength(0);
    expect(roofPolygons(p)).toHaveLength(0);
  });
  test("T junctions divide rooms without manually splitting exterior walls", () => {
    const p = rectangle();
    p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"));
    const rooms = detectRooms(p.walls);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].id).not.toBe(rooms[1].id);
    expect(rooms.reduce((sum, r) => sum + r.area, 0)).toBeCloseTo(228 * 174 / 144);
    expect(roofPolygons(p)).toHaveLength(1);
  });
  test("crossing partitions generate four rooms and dimension their segments", () => {
    const p = rectangle();
    p.walls.push(wall("vertical", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"), wall("horizontal", { x: 0, y: 90 }, { x: 240, y: 90 }, "interior"));
    expect(detectRooms(p.walls)).toHaveLength(4);
    const dimensions = automaticDimensions(p);
    for (const room of detectRooms(p.walls)) {
      expect(dimensions.filter(d => d.roomId === room.id).map(d => d.value).sort((a, b) => a - b)).toEqual([84, 84, 114, 114]);
    }
  });
  test("dangling partitions do not invent rooms or shrink room boundaries", () => {
    const p = rectangle(); p.walls.push(wall("stub", { x: 120, y: 0 }, { x: 120, y: 60 }, "interior"));
    const rooms = detectRooms(p.walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(234 * 174 / 144);
    expect(rooms[0].wallIds).not.toContain("stub");
  });
  test("angled walls generate the correct bounded triangular room", () => {
    const p = blankPlan();
    p.walls = [wall("a", { x: 0, y: 0 }, { x: 120, y: 0 }), wall("b", { x: 120, y: 0 }, { x: 0, y: 120 }), wall("c", { x: 0, y: 120 }, { x: 0, y: 0 })];
    const rooms = detectRooms(p.walls);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeGreaterThan(35);
    expect(rooms[0].area).toBeLessThan(50);
    expect(pointInPolygon(rooms[0].center, rooms[0].inner)).toBe(true);
  });
  test("furnished example has four rooms and a closed exterior", () => {
    const p = starterPlan(); expect(detectRooms(p.walls)).toHaveLength(4); expect(roofPolygons(p)).toHaveLength(1);
  });
  test("reversing wall directions does not change room area or identity", () => {
    const p = rectangle(), original = detectRooms(p.walls)[0];
    p.walls = p.walls.map(w => ({ ...w, a: w.b, b: w.a })).reverse();
    const after = detectRooms(p.walls)[0]; expect(after.id).toBe(original.id); expect(after.area).toBeCloseTo(original.area);
  });
});

describe("roof geometry", () => {
  test("gable roofs have two planes and a ridge spanning the longer building axis", () => {
    const p = rectangle(); p.roofType = "gable";
    const roof = roofLayouts(p)[0];
    expect(roof.error).toBeUndefined();
    expect(roof.faces).toHaveLength(2);
    expect(roof.lines).toEqual([{ a: { x: -21, y: 90 }, b: { x: 261, y: 90 }, kind: "ridge" }]);
    const tall = rectangle(); tall.roofType = "gable"; tall.walls = tall.walls.map(w => ({ ...w, a: { x: w.a.y, y: w.a.x }, b: { x: w.b.y, y: w.b.x } }));
    expect(roofLayouts(tall)[0].lines).toEqual([{ a: { x: 90, y: -21 }, b: { x: 90, y: 261 }, kind: "ridge" }]);
  });
  test("hip roofs have four planes, four corner hips, and a shorter centered ridge", () => {
    const p = rectangle(); p.roofType = "hip";
    const roof = roofLayouts(p)[0];
    expect(roof.error).toBeUndefined();
    expect(roof.faces).toHaveLength(4);
    expect(roof.lines.filter(line => line.kind === "hip")).toHaveLength(4);
    expect(roof.lines.filter(line => line.kind === "ridge")).toEqual([{ a: { x: 90, y: 90 }, b: { x: 150, y: 90 }, kind: "ridge" }]);
    expect(roof.faces.reduce((sum, face) => sum + Math.abs(polygonArea(face.points)), 0)).toBeCloseTo(Math.abs(polygonArea(roof.perimeter)));
  });
  test("square roofs switch from a pyramid hip to a full gable ridge", () => {
    const square = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }];
    const hip = roofForPolygon(square, "hip"), gable = roofForPolygon(square, "gable");
    expect(hip.lines.filter(line => line.kind === "hip")).toHaveLength(4);
    expect(hip.lines.filter(line => line.kind === "ridge")).toHaveLength(0);
    expect(gable.lines).toEqual([{ a: { x: 0, y: 90 }, b: { x: 180, y: 90 }, kind: "ridge" }]);
    expect(roofForPolygon([...square].reverse(), "gable").lines).toEqual(gable.lines);
  });
  test("L, T, and U footprints get connected roof planes and valleys in both styles", () => {
    const shapes = [
      [[0, 0], [240, 0], [240, 120], [120, 120], [120, 240], [0, 240]],
      [[0, 0], [360, 0], [360, 120], [240, 120], [240, 300], [120, 300], [120, 120], [0, 120]],
      [[0, 0], [360, 0], [360, 300], [240, 300], [240, 120], [120, 120], [120, 300], [0, 300]],
    ];
    for (const shape of shapes) for (const type of ["gable", "hip"] as const) {
      const polygon = shape.map(([x, y]) => ({ x, y })), roof = roofForPolygon(polygon, type);
      expect(roof.error).toBeUndefined();
      expect(roof.lines.some(line => line.kind === "valley")).toBe(true);
      expect(roof.lines.some(line => line.kind === "ridge")).toBe(true);
      expect(roof.faces.reduce((sum, face) => sum + Math.abs(polygonArea(face.points)), 0)).toBeCloseTo(Math.abs(polygonArea(polygon)));
      for (const line of roof.lines) {
        for (const t of [0.25, 0.5, 0.75]) expect(pointInPolygon({ x: line.a.x + (line.b.x - line.a.x) * t, y: line.a.y + (line.b.y - line.a.y) * t }, polygon)).toBe(true);
      }
      if (type === "gable") {
        const hip = roofForPolygon(polygon, "hip");
        expect(roof.lines.filter(line => line.kind === "hip").length).toBeLessThan(hip.lines.filter(line => line.kind === "hip").length);
      }
    }
  });
  test("rotated roofs follow their wall angles and collinear wall splits do not add seams", () => {
    const corners = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 180 }, { x: 0, y: 180 }];
    const angle = Math.PI / 6, rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle) + 300, y: p.x * Math.sin(angle) + p.y * Math.cos(angle) - 150 });
    for (const type of ["gable", "hip"] as const) {
      const original = roofForPolygon(corners, type), rotated = roofForPolygon(corners.map(rotate), type);
      expect(rotated.error).toBeUndefined();
      expect(rotated.lines).toHaveLength(original.lines.length);
      for (const line of original.lines) {
        const a = rotate(line.a), b = rotate(line.b);
        expect(rotated.lines.some(l => l.kind === line.kind && ((Math.hypot(l.a.x - a.x, l.a.y - a.y) < 0.01 && Math.hypot(l.b.x - b.x, l.b.y - b.y) < 0.01) || (Math.hypot(l.b.x - a.x, l.b.y - a.y) < 0.01 && Math.hypot(l.a.x - b.x, l.a.y - b.y) < 0.01)))).toBe(true);
      }
      expect(roofForPolygon([corners[0], { x: 120, y: 0 }, ...corners.slice(1)], type).lines).toEqual(original.lines);
    }
  });
  test("roof layouts regenerate for wall edits, overhang, and type and ignore interior partitions", () => {
    const p = starterPlan(); p.roofType = "gable";
    const first = roofLayouts(p);
    expect(roofLayouts({ ...p, name: "Renamed" })).toBe(first);
    expect(roofLayouts({ ...p, roofType: "hip" })[0].lines).toHaveLength(5);
    expect(roofLayouts({ ...p, roofOverhang: 36 })[0].lines[0].a.x).toBe(-39);
    const exteriorOnly = { ...p, walls: p.walls.filter(w => w.kind === "exterior") };
    expect(roofLayouts(exteriorOnly)[0].lines).toEqual(first[0].lines);
    const moved = moveWallPoint(p, "north", "b", { x: 540, y: 0 });
    expect(roofLayouts(moved)[0].lines).not.toEqual(first[0].lines);
    exteriorOnly.walls.pop();
    expect(roofLayouts({ ...exteriorOnly, walls: [...exteriorOnly.walls] })).toEqual([]);
  });
  test("separate buildings each receive independent roof structures", () => {
    const p = rectangle(), other = rectangle();
    p.walls.push(...other.walls.map(w => ({ ...w, id: `other-${w.id}`, a: { x: w.a.x + 400, y: w.a.y }, b: { x: w.b.x + 400, y: w.b.y } })));
    for (const type of ["gable", "hip"] as const) {
      const roofs = roofLayouts({ ...p, roofType: type });
      expect(roofs).toHaveLength(2);
      expect(roofs.every(roof => roof.lines.length === (type === "gable" ? 1 : 5) && !roof.error)).toBe(true);
    }
  });
  test("roof overhang is measured from exterior wall faces", () => {
    const p = rectangle(); p.roofOverhang = 12;
    const roof = roofPolygons(p)[0];
    expect(bounds(roof)).toEqual({ x: -15, y: -15, width: 270, height: 210 });
  });
  test("L-shaped roofs preserve concave corners", () => {
    const p = blankPlan();
    const ps = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 0, y: 240 }];
    p.walls = ps.map((a, i) => wall(`l${i}`, a, ps[(i + 1) % ps.length])); p.roofOverhang = 12;
    const roof = roofPolygons(p)[0];
    expect(roof).toHaveLength(6); expect(roof[3]).toEqual({ x: 135, y: 135 });
    expect(pointInPolygon({ x: 210, y: 210 }, roof)).toBe(false);
    expect(detectRooms(p.walls)).toHaveLength(1);
  });
  test("separate closed buildings each receive a roof", () => {
    const p = rectangle(), second = rectangle(60, 60);
    p.walls.push(...second.walls.map(w => ({ ...w, id: `${w.id}-annex`, a: { x: w.a.x + 360, y: w.a.y }, b: { x: w.b.x + 360, y: w.b.y } })));
    expect(roofPolygons(p)).toHaveLength(2);
  });
  test("offset supports reversed polygon winding", () => {
    const poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(Math.abs(polygonArea(offsetPolygon(poly, 10)))).toBeCloseTo(Math.abs(polygonArea(offsetPolygon([...poly].reverse(), 10))));
  });
});

describe("wall connections and openings", () => {
  test("dimension keys stay unique when named exterior walls become inset", () => {
    const p = starterPlan();
    p.walls.push(wall("outer-west", { x: -48, y: 60 }, { x: -48, y: 120 }));
    const dimensions = automaticDimensions(p);
    expect(dimensions.some(d => d.id.startsWith("exterior:side:west:segment:"))).toBe(true);
    expect(dimensions.some(d => d.id.startsWith("wall:west:segment:"))).toBe(true);
    expect(new Set(dimensions.map(d => d.id)).size).toBe(dimensions.length);
  });
  test("moving corners also moves attached endpoints along the resized host wall", () => {
    const p = rectangle(); p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"));
    const moved = moveWallPoint(p, "w0", "b", { x: 300, y: 0 });
    expect(moved.walls.find(w => w.id === "w1")!.a).toEqual({ x: 300, y: 0 });
    expect(moved.walls.find(w => w.id === "partition")!.a).toEqual({ x: 150, y: 0 });
    expect(detectRooms(moved.walls)).toHaveLength(2);
  });
  test("snapping prioritizes endpoints and projects T junctions precisely", () => {
    const p = rectangle();
    expect(snapPoint({ x: 3, y: 2 }, p.walls, 6, 10)).toEqual({ x: 0, y: 0 });
    expect(snapPoint({ x: 122, y: 4 }, p.walls, 6, 10)).toEqual({ x: 120, y: 0 });
    expect(snapPoint({ x: 125, y: 78 }, p.walls, 6, 10, { x: 120, y: 0 }, true)).toEqual({ x: 120, y: 78 });
  });
  test("nearby off-axis corners cannot override straight-line snapping", () => {
    const host = wall("offset-corner", { x: 120, y: 6 }, { x: 156, y: 42 });
    expect(snapPoint({ x: 120, y: 5 }, [host], 6, 10, { x: 0, y: 0 }, true)).toEqual({ x: 120, y: 0 });
    expect(snapPoint({ x: 120, y: 5 }, [host], 6, 10, { x: 0, y: 0 }, false)).toEqual(host.a);
    const verticalHost = wall("offset-vertical", { x: 36, y: 108 }, { x: 72, y: 144 });
    expect(snapPoint({ x: 34, y: 110 }, [verticalHost], 6, 10, { x: 30, y: 20 }, true)).toEqual({ x: 30, y: 108 });
  });
  test("straight-line snapping meets angled walls at their axis intersection", () => {
    const diagonal = wall("diagonal", { x: 90, y: -30 }, { x: 150, y: 30 });
    expect(snapPoint({ x: 126, y: 3 }, [diagonal], 6, 10, { x: 0, y: 0 }, true)).toEqual({ x: 120, y: 0 });
    expect(snapPoint({ x: 126, y: 3 }, [diagonal], 6, 10, { x: 0, y: 0 }, false)).toEqual({ x: 126, y: 6 });
  });
  test("openings cannot overlap or overflow wall ends", () => {
    const w = rectangle().walls[0];
    expect(fitOpening(w, 300, 0.5)).toBeNull();
    const t = fitOpening(w, 36, 0)!; expect(t * 240).toBe(22);
    const existing = { id: "door", wallId: w.id, kind: "door" as const, width: 36, t: 0.5, flip: false };
    expect(fitOpening(w, 48, 0.5, [existing])).toBeNull();
    expect(fitOpening(w, 48, 0.25, [existing])).not.toBeNull();
    expect(fitOpening(w, 36, 0.5, [existing], existing.id)).toBe(0.5);
  });
  describe.each(["door", "window"] as const)("%s wall clearance", kind => {
    test("jambs keep four inches from adjacent wall faces at either corner", () => {
      const p = rectangle(), w = p.walls[0], context = { kind, walls: p.walls };
      expect(fitOpening(w, 36, 0, [], undefined, context)! * 240).toBe(25);
      expect(fitOpening(w, 36, 1, [], undefined, context)! * 240).toBe(215);
      expect(fitOpening(w, 36, 0, [], undefined, { kind, walls: [w] })! * 240).toBe(22);
      const reversed = { ...w, a: w.b, b: w.a };
      expect(fitOpening(reversed, 36, 0, [], undefined, context)! * 240).toBe(25);
    });
    test("openings keep clearance from T junctions and crossing walls anywhere along the host", () => {
      const p = rectangle(), w = p.walls[0];
      for (const y of [0, -60]) {
        const partition = wall("partition", { x: 120, y }, { x: 120, y: 120 }, "interior");
        const context = { kind, walls: [...p.walls, partition] };
        expect(fitOpening(w, 36, .49, [], undefined, context)! * 240).toBe(95);
        expect(fitOpening(w, 36, .51, [], undefined, context)! * 240).toBe(145);
        expect(fitOpening(w, 36, 95 / 240, [], undefined, context)! * 240).toBe(95);
        expect(fitOpening(w, 36, 145 / 240, [], undefined, context)! * 240).toBe(145);
        expect(fitOpening(w, 200, .5, [], undefined, context)).toBeNull();
      }
    });
    test("angled corners measure clearance across both wall faces in any orientation", () => {
      const host = wall("host", { x: 0, y: 0 }, { x: 240, y: 0 });
      const adjacent = wall("angled", { x: 0, y: 0 }, { x: 100, y: 100 });
      const expected = 18 + 4 + 3 + 3 * Math.SQRT2;
      for (const angle of [0, Math.PI / 3, Math.PI / 2]) {
        const transform = (p: Point) => ({ x: 42 + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: -35 + p.x * Math.sin(angle) + p.y * Math.cos(angle) });
        const walls = [host, adjacent].map(w => ({ ...w, a: transform(w.a), b: transform(w.b) }));
        expect(fitOpening(walls[0], 36, 0, [], undefined, { kind, walls })! * 240).toBeCloseTo(expected, 8);
      }
    });
    test("continued walls and detached nearby walls do not obstruct openings", () => {
      const host = rectangle().walls[0];
      const walls = [host, wall("continuation", { x: 100, y: 0 }, { x: 200, y: 0 }), wall("nearby", { x: 120, y: 20 }, { x: 120, y: 80 })];
      expect(fitOpening(host, 36, .5, [], undefined, { kind, walls })).toBe(.5);
    });
    test("an exactly fitting opening is allowed, while a narrower wall has no safe position", () => {
      for (const length of [50, 49]) {
        const walls = [wall("host", { x: 0, y: 0 }, { x: length, y: 0 }), wall("left", { x: 0, y: 0 }, { x: 0, y: 100 }), wall("right", { x: length, y: 0 }, { x: length, y: 100 })];
        expect(fitOpening(walls[0], 36, .5, [], undefined, { kind, walls })).toBe(length === 50 ? .5 : null);
      }
    });
    test("opening resizing, wall reshaping and group moves enforce the same clearance", () => {
      const p = rectangle(), w = p.walls[0];
      const opening = { id: "door", wallId: w.id, kind, width: 36, t: 25 / 240, flip: false };
      p.openings.push(opening);
      expect(fitOpening(w, 42, opening.t, p.openings, opening.id, { kind: opening.kind, walls: p.walls })! * 240).toBe(28);
      expect(() => moveSelection(p, [{ type: "opening", id: opening.id }], { x: -1, y: 0 })).toThrow("less than 4″");
      expect(moveSelection(p, [{ type: "opening", id: opening.id }], { x: 1, y: 0 }).openings[0].t * 240).toBe(26);
      const walls = p.walls.map(wall => wall.id === "w3" ? { ...wall, thickness: 12 } : wall);
      expect(normalizeOpenings(walls, p.openings)[0].t * 240).toBe(28);
      const moved = moveWallPoint(p, w.id, "b", { x: 200, y: 0 });
      expect(moved.openings[0].t * 200).toBe(25);
      expect(fitOpening(w, 36, opening.t, [{ ...opening, id: "other" }], undefined, { kind: opening.kind, walls: p.walls })).toBeNull();
    });
  });
  test("openings cut actual gaps in rendered walls and dimension chains", () => {
    const p = rectangle(), w = p.walls[0];
    p.openings.push({ id: "d", wallId: w.id, kind: "door", width: 36, t: 0.5, flip: false });
    expect(wallSegments(w, p)).toEqual([{ a: { x: 0, y: 0 }, b: { x: 102, y: 0 } }, { a: { x: 138, y: 0 }, b: { x: 240, y: 0 } }]);
    expect(automaticDimensions(p).filter(d => d.id.startsWith("exterior:side:north:segment:")).map(d => d.value)).toEqual([102, 36, 102]);
  });
  test("interior dimensions include door jambs and the opening width", () => {
    const p = rectangle();
    const w = wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior");
    p.walls.push(w); p.openings.push({ id: "d", wallId: w.id, kind: "door", width: 36, t: 0.5, flip: false });
    const dimensions = automaticDimensions(p);
    expect(dimensions.filter(d => d.openingId === "d")).toHaveLength(2);
    expect(dimensions.filter(d => d.openingId === "d" && !d.hideLabel)).toHaveLength(1);
    for (const room of detectRooms(p.walls)) {
      const openingChain = dimensions.filter(d => d.roomId === room.id && Math.abs(d.a.x - d.b.x) < 0.01 && !d.overall && d.value <= 69);
      expect(openingChain.map(d => d.value)).toEqual([69, 36, 69]);
      expect(dimensions.some(d => d.roomId === room.id && d.overall)).toBe(false);
    }
  });
});

describe("clear room dimensions near walls", () => {
  test("adding, moving, rotating and removing fixtures never changes interior dimension placement", () => {
    for (const angle of [0, Math.PI / 4]) {
      const p = starterPlan(); p.fixtures = [];
      const rotate = (point: Point) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
      for (const w of p.walls) { w.a = rotate(w.a); w.b = rotate(w.b); }
      const baseline = automaticDimensions(p);
      const dimensions = baseline.filter(d => d.roomId && d.value > 72);
      p.fixtures = dimensions.map((d, i) => {
        const dx = (d.b.x - d.a.x) / d.value, dy = (d.b.y - d.a.y) / d.value;
        return { id: `fixture-${i}`, catalogId: i % 2 ? "queen-bed" : "toilet", width: 72, depth: 30, rotation: Math.atan2(dy, dx) * 180 / Math.PI,
          x: (d.a.x + d.b.x) / 2 - dy * d.offset, y: (d.a.y + d.b.y) / 2 + dx * d.offset };
      });
      expect(automaticDimensions(p)).toEqual(baseline);
      p.fixtures = p.fixtures.map(f => ({ ...f, x: f.x + 18, y: f.y - 12, rotation: f.rotation + 90, width: 100 }));
      expect(automaticDimensions(p)).toEqual(baseline);
      p.fixtures = [];
      expect(automaticDimensions(p)).toEqual(baseline);
    }
  });
  test("room faces and open interior partitions consistently mark labels for centering", () => {
    const p = rectangle();
    p.walls.push(wall("stub", { x: 120, y: 0 }, { x: 120, y: 60 }, "interior"));
    p.openings.push({ id: "window", wallId: "w0", kind: "window", t: 0.5, width: 24, flip: false });
    const dimensions = automaticDimensions(p);
    const inside = dimensions.filter(d => d.roomId || d.id.startsWith("wall:stub:"));
    expect(inside.length).toBeGreaterThan(4);
    expect(inside.every(d => d.interior)).toBe(true);
    expect(dimensions.filter(d => d.id.startsWith("exterior:side:")).every(d => !d.interior)).toBe(true);
  });
  test("shared doors have one width label in the gap and windows keep their wall side at any angle", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const flip of [false, true]) for (const reverse of [false, true]) {
      const p = rectangle();
      const w = wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior");
      if (reverse) [w.a, w.b] = [w.b, w.a];
      p.walls.push(w);
      p.openings = [
        { id: "door", wallId: w.id, kind: "door", width: 36, t: 0.25, flip },
        { id: "window", wallId: w.id, kind: "window", width: 24, t: 0.75, flip },
      ];
      const rotate = (point: Point) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
      for (const wall of p.walls) { wall.a = rotate(wall.a); wall.b = rotate(wall.b); }
      for (const opening of p.openings) {
        const dimensions = automaticDimensions(p).filter(d => d.openingId === opening.id);
        expect(dimensions).toHaveLength(2);
        const labels = dimensions.filter(d => !d.hideLabel);
        expect(labels).toHaveLength(1);
        expect(labels[0].value).toBeCloseTo(opening.width);
        const mid = { x: (labels[0].a.x + labels[0].b.x) / 2, y: (labels[0].a.y + labels[0].b.y) / 2 };
        const side = (w.b.x - w.a.x) * (mid.y - w.a.y) - (w.b.y - w.a.y) * (mid.x - w.a.x);
        if (opening.kind === "door") {
          expect(Math.abs(side)).toBeLessThan(1e-8);
          expect(labels[0].offset).toBe(0);
          expect(labels[0].doorway).toBe(true);
          expect(mid.x).toBeCloseTo(w.a.x + (w.b.x - w.a.x) * opening.t);
          expect(mid.y).toBeCloseTo(w.a.y + (w.b.y - w.a.y) * opening.t);
        } else expect(side > 0).toBe(true);
        p.walls.reverse();
        const reordered = automaticDimensions(p).find(d => d.openingId === opening.id && !d.hideLabel)!;
        expect(reordered.a).toEqual(labels[0].a);
        expect(reordered.b).toEqual(labels[0].b);
      }
    }
  });
  test("exterior and unclosed wall doorways put their width between the actual jambs", () => {
    for (const closed of [false, true]) for (const kind of ["interior", "exterior"] as const) for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const p = closed ? rectangle() : blankPlan();
      const w = closed ? p.walls[0] : wall("open", { x: 0, y: 0 }, { x: 240, y: 0 }, kind);
      w.kind = kind;
      if (!closed) p.walls.push(w);
      const rotate = (point: Point) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
      for (const wall of p.walls) { wall.a = rotate(wall.a); wall.b = rotate(wall.b); }
      p.openings.push({ id: "door", wallId: w.id, kind: "door", t: 0.4, width: 32, flip: true });
      const labels = automaticDimensions(p).filter(d => d.openingId === "door" && !d.hideLabel);
      expect(labels).toHaveLength(1);
      const d = labels[0];
      expect(d.doorway).toBe(true);
      expect(d.value).toBe(32);
      expect(d.offset).toBe(0);
      expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)).toBeCloseTo(32);
      expect((d.a.x + d.b.x) / 2).toBeCloseTo(w.a.x + (w.b.x - w.a.x) * 0.4);
      expect((d.a.y + d.b.y) / 2).toBeCloseTo(w.a.y + (w.b.y - w.a.y) * 0.4);
    }
  });
  test("a doorway near a corner has one full-width label even when the room face clips its span", () => {
    const p = rectangle();
    p.openings.push({ id: "corner-door", wallId: "w0", kind: "door", t: 13 / 240, width: 24, flip: false });
    const dimensions = automaticDimensions(p);
    const labels = dimensions.filter(d => d.openingId === "corner-door" && !d.hideLabel);
    expect(labels).toHaveLength(1);
    expect(labels[0].a.x).toBeCloseTo(1);
    expect(labels[0].a.y).toBe(0);
    expect(labels[0].b.x).toBeCloseTo(25);
    expect(labels[0].b.y).toBe(0);
    expect(labels[0].value).toBe(24);
    expect(labels[0].offset).toBe(0);
  });
  test("an opening with only one room face keeps its width label for either swing direction", () => {
    for (const flip of [false, true]) {
      const p = rectangle(), w = p.walls[1];
      w.kind = "interior";
      p.openings.push({ id: "door", wallId: w.id, kind: "door", width: 36, t: 0.5, flip });
      const dimensions = automaticDimensions(p).filter(d => d.openingId === "door");
      expect(dimensions).toHaveLength(1);
      expect(dimensions[0].hideLabel).toBeUndefined();
    }
  });
  test("every sample room gets inside-face measurements on all of its sides", () => {
    const p = starterPlan(), rooms = detectRooms(p.walls), dimensions = automaticDimensions(p);
    for (const room of rooms) {
      const edges = new Set(dimensions.filter(d => d.roomId === room.id).map(d => d.id.split(":edge:")[1].split(":")[0]));
      expect(edges.size).toBe(4);
      expect(dimensions.filter(d => d.roomId === room.id).every(d => (d.doorway ? d.offset === 0 : d.offset >= 14 && d.offset <= 32))).toBe(true);
    }
    const living = rooms.find(r => r.center.x < 288)!;
    const clear = dimensions.filter(d => d.roomId === living.id);
    const lengths = [...new Set(clear.map(d => d.id.split(":segment:")[0]))].map(edge => clear.filter(d => d.id.startsWith(`${edge}:segment:`)).reduce((sum, d) => sum + d.value, 0));
    lengths.sort((a, b) => a - b).forEach((length, i) => expect(length).toBeCloseTo([282.75, 282.75, 354, 354][i]));
    expect(clear.some(d => d.overall)).toBe(false);
    expect(dimensions.some(d => d.id.startsWith("exterior:side:") && d.overall)).toBe(true);
    expect(new Set(dimensions.map(d => d.id)).size).toBe(dimensions.length);
  });
  test("collinear T junctions do not split a room's full clear width", () => {
    const p = rectangle(); p.walls.push(wall("stub", { x: 120, y: 0 }, { x: 120, y: 60 }, "interior"));
    const dimensions = automaticDimensions(p), room = detectRooms(p.walls)[0];
    expect(dimensions.filter(d => d.roomId === room.id).map(d => d.value).sort((a, b) => a - b)).toEqual([174, 174, 234, 234]);
    expect(dimensions.some(d => d.id === "wall:stub:segment:0" && d.value === 60)).toBe(true);
  });
  test("angled and concave rooms use actual clear wall faces", () => {
    const p = blankPlan();
    const corners = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }];
    p.walls = corners.map((a, i) => wall(`angle-${i}`, a, corners[(i + 1) % corners.length]));
    const room = detectRooms(p.walls)[0];
    const dims = automaticDimensions(p).filter(d => d.roomId === room.id);
    expect(dims).toHaveLength(4);
    for (const dim of dims) {
      expect(dim.value).toBeCloseTo(Math.hypot(dim.b.x - dim.a.x, dim.b.y - dim.a.y));
      expect(room.inner.some(p => Math.hypot(p.x - dim.a.x, p.y - dim.a.y) < 0.01)).toBe(true);
    }
    const l = blankPlan();
    const lc = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 0, y: 240 }];
    l.walls = lc.map((a, i) => wall(`l-${i}`, a, lc[(i + 1) % lc.length]));
    expect(automaticDimensions(l).filter(d => d.roomId)).toHaveLength(6);
  });
  test("open plans have no room measurements and moving walls recomputes clear spans", () => {
    const p = rectangle();
    p.walls.pop(); expect(automaticDimensions(p).filter(d => d.roomId)).toEqual([]);
    const closed = rectangle(), moved = moveWallPoint(closed, "w0", "b", { x: 300, y: 0 });
    const before = automaticDimensions(closed).filter(d => d.roomId).map(d => d.value);
    const after = automaticDimensions(moved).filter(d => d.roomId).map(d => d.value);
    expect(after).not.toEqual(before);
    expect(after.some(value => value > 290)).toBe(true);
  });
});

describe("editing dimensions", () => {
  test("length input accepts inches, feet/inches, decimals, fractions and printed prime symbols", () => {
    for (const [text, value] of [["10", 120], ["120", 1440], ["8.5", 102], [" 10 ", 120], ['120"', 120], ["10'", 120], ["10' 0\"", 120], ["8'-6\"", 102], [".5\"", .5], ["8' 6 1/2\"", 102.5], ["102½″", 102.5], ["8′ 6½″", 102.5], ["1/2", 6], ["8 1/2", 102], ['1/2"', .5], ["0' 6\"", 6], ["8.5'", 102]] as const) expect(parseLengthInput(text)).toBe(value);
    for (const text of ["", "-12", "0", "Infinity", "NaN", "1/0", "10 6", "12ft", "1e3", "8''", '10" 4', "8' - -6\""]) expect(() => parseLengthInput(text)).toThrow();
  });
  test("an exterior total moves the entire end wall and its corners without drifting interior partitions", () => {
    const p = rectangle(); p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"));
    const moved = editDimension(p, "exterior:side:north:overall", 300);
    expect(moved.walls.find(w => w.id === "w1")!.a).toEqual({ x: 300, y: 0 });
    expect(moved.walls.find(w => w.id === "w1")!.b).toEqual({ x: 300, y: 180 });
    expect(moved.walls.find(w => w.id === "w2")!.a).toEqual({ x: 300, y: 180 });
    expect(moved.walls.find(w => w.id === "partition")).toEqual(p.walls.at(-1));
    expect(detectRooms(moved.walls)).toHaveLength(2);
    expect(roofPolygons(moved)[0].some(point => point.x > 300)).toBe(true);
    expect(p.walls[1].a.x).toBe(240);
  });
  test("clear interior edits move the partition and attached branches while keeping the opposite outer wall fixed", () => {
    const p = rectangle(); p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"), wall("branch", { x: 120, y: 90 }, { x: 240, y: 90 }, "interior"));
    p.openings = [{ id: "door", kind: "door", wallId: "partition", t: .25, width: 24, flip: false, hinge: "right" }];
    const dim = automaticDimensions(p).find(d => d.roomId && Math.min(d.a.x, d.b.x) < 10 && Math.abs(d.a.y - 3) < .01 && Math.abs(d.b.y - 3) < .01 && d.value === 114)!;
    const moved = editDimension(p, dim.id, 144);
    expect(moved.walls.find(w => w.id === "partition")!.a).toEqual({ x: 150, y: 0 });
    expect(moved.walls.find(w => w.id === "partition")!.b).toEqual({ x: 150, y: 180 });
    expect(moved.walls.find(w => w.id === "branch")!.a).toEqual({ x: 150, y: 90 });
    expect(moved.walls[1]).toEqual(p.walls[1]);
    expect(moved.openings[0]).toMatchObject({ t: .25, width: 24, hinge: "right" });
    expect(automaticDimensions(moved).find(d => d.id === dim.id)!.value).toBeCloseTo(144, 5);
    expect(detectRooms(moved.walls)).toHaveLength(3);
    const otherEnd = editDimension(p, dim.id, 144, "end");
    expect(otherEnd.walls.find(w => w.id === "partition")).toEqual(p.walls.find(w => w.id === "partition"));
    expect(otherEnd.walls.find(w => w.id === "w3")!.a.x).toBe(-30);
  });
  test("bottom-face dimensions use the same left/right anchors and preserve attached wall segments", () => {
    const p = rectangle();
    const bottom = automaticDimensions(p).find(d => d.roomId && Math.abs(d.a.y - 177) < .01 && Math.abs(d.b.y - 177) < .01)!;
    expect(dimensionEnds(bottom).start.x).toBe(3);
    const moved = editDimension(p, bottom.id, 294);
    expect(moved.walls[1].a.x).toBe(300);
    expect(moved.walls[1].b.x).toBe(300);
    expect(detectRooms(moved.walls)).toHaveLength(1);
  });
  test("jamb-offset edits reposition openings and adjoining wall spans keep the fixed jamb in place", () => {
    const p = rectangle();
    p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .5, flip: true }];
    const offset = editDimension(p, "exterior:side:north:segment:0", 120);
    expect(offset.walls).toEqual(p.walls);
    expect(offset.openings[0].t * 240).toBeCloseTo(138, 5);
    const wallSpan = editDimension(p, "exterior:side:north:segment:2", 120);
    expect(wallSpan.walls[1].a.x).toBe(258);
    expect(wallSpan.openings[0].t * 258).toBeCloseTo(120, 5);
    const width = editDimension(p, "exterior:side:north:segment:1", 48);
    expect(width.openings[0]).toMatchObject({ width: 48, t: .525, flip: true });
    expect(width.walls).toEqual(p.walls);
  });
  test("opening labels resize the gap and impossible edits preserve the entire source drawing", () => {
    const p = rectangle();
    p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .5, flip: true, hinge: "right" }];
    const dim = automaticDimensions(p).find(d => d.doorway)!;
    const before = JSON.stringify(p), moved = editDimension(p, dim.id, 42);
    expect(moved.openings[0]).toMatchObject({ width: 42, t: .5125, flip: true, hinge: "right" });
    const opposite = editDimension(p, dim.id, 42, "end");
    expect(opposite.openings[0]).toMatchObject({ width: 42, t: .4875, flip: true, hinge: "right" });
    // Canonical moving sides are independent of the host wall's drawing direction.
    const reversed = { ...p, walls: p.walls.map(w => w.id === "w0" ? { ...w, a: w.b, b: w.a } : w) };
    const reversedDim = automaticDimensions(reversed).find(d => d.doorway)!;
    expect(editDimension(reversed, reversedDim.id, 42).openings[0].t).toBeCloseTo(.4875, 5);
    expect(() => editDimension(p, dim.id, 239)).toThrow();
    expect(() => editDimension(p, "exterior:side:north:overall", 20)).toThrow();
    expect(JSON.stringify(p)).toBe(before);
  });
  test("angled room dimensions move their boundary and regenerate exact clear measurements", () => {
    const p = rectangle(), angle = Math.PI / 6;
    const rotate = (point: Point) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
    p.walls = p.walls.map(w => ({ ...w, a: rotate(w.a), b: rotate(w.b) }));
    const dim = automaticDimensions(p).find(d => d.roomId && Math.abs(d.value - 234) < .01)!;
    const moved = editDimension(p, dim.id, 270);
    expect(automaticDimensions(moved).find(d => d.id === dim.id)!.value).toBeCloseTo(270, 2);
    expect(detectRooms(moved.walls)).toHaveLength(1);
    const triangle = blankPlan();
    triangle.walls = [wall("a", { x: 0, y: 0 }, { x: 240, y: 0 }), wall("b", { x: 240, y: 0 }, { x: 120, y: 180 }), wall("c", { x: 120, y: 180 }, { x: 0, y: 0 })];
    const clear = automaticDimensions(triangle).find(d => d.roomId && Math.abs(d.a.y - d.b.y) < .01)!;
    const resized = editDimension(triangle, clear.id, clear.value + 36);
    expect(automaticDimensions(resized).find(d => d.id === clear.id)!.value).toBeCloseTo(clear.value + 36, 2);
    expect(detectRooms(resized.walls)).toHaveLength(1);
  });
  test("open walls and their attached T junctions stay connected when their dimension is resized", () => {
    const p = blankPlan(); p.walls = [wall("host", { x: 0, y: 0 }, { x: 120, y: 120 }, "interior"), wall("branch", { x: 60, y: 60 }, { x: 120, y: 0 }, "interior")];
    const dim = automaticDimensions(p).find(d => d.id === "wall:host:segment:1")!;
    const moved = editDimension(p, dim.id, dim.value + 24);
    expect(moved.walls[0].b.x).toBeGreaterThan(120);
    expect(moved.walls[1].a).toEqual({ x: 60, y: 60 });
    expect(automaticDimensions(moved).find(d => d.id === dim.id)!.value).toBeCloseTo(dim.value + 24, 2);
  });
  test("every visible sample measurement can be edited from either fixed end without changing furniture", () => {
    const p = starterPlan();
    for (const dim of automaticDimensions(p).filter(d => !d.hideLabel)) for (const fixed of ["start", "end"] as const) {
      const updated = editDimension(p, dim.id, dim.value + 6, fixed);
      expect(automaticDimensions(updated).find(d => d.id === dim.id)!.value).toBeCloseTo(dim.value + 6, 2);
      expect(updated.fixtures).toEqual(p.fixtures);
      expect(detectRooms(updated.walls)).toHaveLength(4);
    }
  });
});

describe("group selections", () => {
  test("marquee intersects real wall and rotated fixture shapes rather than their bounding boxes", () => {
    const p = blankPlan();
    p.walls = [wall("diagonal", { x: 0, y: 0 }, { x: 100, y: 100 }, "interior")];
    p.fixtures = [{ id: "rotated", catalogId: "queen-bed", x: 80, y: 80, width: 100, depth: 4, rotation: 45 }];
    expect(selectInBox(p, { x: 0, y: 90 }, { x: 10, y: 100 }, DEFAULT_LAYERS)).toEqual([]);
    expect(selectInBox(p, { x: 100, y: 40 }, { x: 110, y: 50 }, DEFAULT_LAYERS)).toEqual([]);
    const hits = selectInBox(p, { x: 70, y: 70 }, { x: 90, y: 90 }, DEFAULT_LAYERS);
    expect(hits).toHaveLength(2);
    expect(selectInBox(p, { x: 90, y: 90 }, { x: 70, y: 70 }, DEFAULT_LAYERS)).toEqual(hits);
  });
  test("marquee skips hidden items and rooms and can select an opening without its host wall", () => {
    const p = rectangle();
    p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .5, flip: false }];
    p.fixtures = [{ id: "bed", catalogId: "queen-bed", x: 60, y: 60, width: 60, depth: 80, rotation: 0 }];
    p.notes = [{ id: "note", x: 30, y: 40, width: 72, fontSize: 8, text: "Note", border: true }];
    p.utilities = [{ id: "run", kind: "cold", a: { x: 30, y: 30 }, b: { x: 80, y: 30 } }];
    expect(selectInBox(p, { x: 116, y: -1 }, { x: 124, y: 1 }, DEFAULT_LAYERS)).toEqual([{ type: "opening", id: "door" }]);
    const hidden = { ...DEFAULT_LAYERS, notes: false, fixtures: false, utilities: false };
    expect(selectInBox(p, { x: 20, y: 20 }, { x: 95, y: 110 }, hidden)).toEqual([]);
    expect(visibleSelections(p, DEFAULT_LAYERS)).toHaveLength(8);
    expect(visibleSelections(p, hidden)).toHaveLength(5);
    expect(selectionBounds(p, [{ type: "fixture", id: "bed" }, { type: "text", id: "note" }])?.width).toBeGreaterThan(60);
  });
  test("mixed group moves translate each shared corner once and carry hosted openings", () => {
    const p = rectangle();
    p.walls.push(wall("branch", { x: 120, y: 0 }, { x: 120, y: 90 }, "interior"));
    p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .25, flip: true, hinge: "right" }];
    p.fixtures = [{ id: "bed", catalogId: "queen-bed", x: 60, y: 60, width: 60, depth: 80, rotation: 30 }];
    p.notes = [{ id: "note", x: 30, y: 40, width: 72, fontSize: 8, text: "Note", border: true }];
    p.utilities = [{ id: "run", kind: "cold", a: { x: 30, y: 30 }, b: { x: 80, y: 30 } }];
    const before = JSON.stringify(p);
    const moved = moveSelection(p, [{ type: "wall", id: "w0" }, { type: "wall", id: "w1" }, { type: "opening", id: "door" }, { type: "fixture", id: "bed" }, { type: "text", id: "note" }, { type: "utility", id: "run" }], { x: 12, y: 6 });
    expect(moved.walls[0].a).toEqual({ x: 12, y: 6 });
    expect(moved.walls[0].b).toEqual({ x: 252, y: 6 });
    expect(moved.walls[1].a).toEqual(moved.walls[0].b);
    expect(moved.walls[1].b).toEqual({ x: 252, y: 186 });
    expect(moved.walls[2].a).toEqual(moved.walls[1].b);
    expect(moved.walls[3].b).toEqual(moved.walls[0].a);
    expect(moved.walls[4].a).toEqual({ x: 132, y: 6 });
    expect(moved.walls[4].b).toEqual({ x: 120, y: 90 });
    expect(moved.openings).toEqual(p.openings);
    expect(moved.fixtures[0]).toMatchObject({ x: 72, y: 66, rotation: 30 });
    expect(moved.notes[0]).toMatchObject({ x: 42, y: 46, text: "Note" });
    expect(moved.utilities[0]).toMatchObject({ a: { x: 42, y: 36 }, b: { x: 92, y: 36 } });
    expect(detectRooms(moved.walls)).toHaveLength(1);
    expect(JSON.stringify(p)).toBe(before);
  });
  test("two selected openings slide together and a hosted opening never moves twice", () => {
    const p = rectangle();
    p.openings = [{ id: "a", wallId: "w0", kind: "door", width: 30, t: 1 / 3, flip: false }, { id: "b", wallId: "w0", kind: "window", width: 30, t: 2 / 3, flip: false }];
    const moved = moveSelection(p, [{ type: "opening", id: "a" }, { type: "opening", id: "b" }], { x: 12, y: 6 });
    expect(moved.openings[0].t * 240).toBeCloseTo(92, 5);
    expect(moved.openings[1].t * 240).toBeCloseTo(172, 5);
    expect(moved.walls).toEqual(p.walls);
    const hosted = moveSelection(p, [{ type: "wall", id: "w0" }, { type: "opening", id: "a" }], { x: 12, y: 6 });
    expect(hosted.openings).toEqual(p.openings);
  });
  test("invalid group moves preserve the source instead of dropping openings or collapsing walls", () => {
    const p = rectangle(); p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .5, flip: false }];
    const before = JSON.stringify(p);
    expect(() => moveSelection(p, [{ type: "wall", id: "w0" }, { type: "opening", id: "door" }], { x: 0, y: 180 })).toThrow("collapse");
    expect(() => moveSelection(p, [{ type: "wall", id: "w1" }], { x: -220, y: 0 })).toThrow("opening");
    expect(() => moveSelection(p, [{ type: "opening", id: "door" }], { x: 240, y: 0 })).toThrow("opening");
    expect(JSON.stringify(p)).toBe(before);
  });
  test("bulk delete removes only selected elements and openings hosted by deleted walls", () => {
    const p = rectangle(); p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .5, flip: false }];
    p.fixtures = [{ id: "bed", catalogId: "queen-bed", x: 60, y: 60, width: 60, depth: 80, rotation: 0 }];
    p.notes = [{ id: "note", x: 30, y: 40, width: 72, fontSize: 8, text: "Note", border: true }];
    const deleted = deleteSelection(p, [{ type: "wall", id: "w0" }, { type: "fixture", id: "bed" }]);
    expect(deleted.walls).toHaveLength(3); expect(deleted.openings).toEqual([]); expect(deleted.fixtures).toEqual([]); expect(deleted.notes).toEqual(p.notes);
    expect(parsePlan(deleted)).toEqual(deleted);
    const all = deleteSelection(p, visibleSelections(p, DEFAULT_LAYERS));
    expect(all.walls).toEqual([]); expect(all.openings).toEqual([]); expect(all.notes).toEqual([]);
  });
});

describe("editable backups", () => {
  test("construction notes round-trip, older plans open with no notes, and invalid annotations are rejected", () => {
    const p = rectangle();
    const note = { id: "note", x: 360, y: 0, width: 144, fontSize: 8, text: "Remove partition.\nVerify <existing> & proposed dimensions.", border: true };
    p.notes = [note];
    expect(parsePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const { notes, ...legacy } = p;
    expect(parsePlan(legacy).notes).toEqual([]);
    for (const patch of [{ width: 0 }, { fontSize: NaN }, { text: "x".repeat(2001) }, { border: "yes" }, { x: Infinity }]) {
      expect(() => parsePlan({ ...p, notes: [{ ...note, ...patch }] })).toThrow();
    }
    expect(() => parsePlan({ ...p, notes: [{ ...note, id: p.walls[0].id }] })).toThrow();
    expect(() => parsePlan({ ...p, notes: Array.from({ length: 101 }, (_, i) => ({ ...note, id: `note-${i}` })) })).toThrow();
    expect(parsePlan({ ...p, notes: [{ ...note, text: "" }] }).notes[0].text).toBe("");
    expect(planFingerprint(p)).not.toBe(planFingerprint({ ...p, notes: [{ ...note, text: "Updated work scope" }] }));
  });
  test("note wrapping preserves paragraphs, handles long words and expands its bounds without changing dimensions", () => {
    const p = rectangle(), originalDimensions = automaticDimensions(p);
    const note = { id: "note", x: 360, y: 0, width: 144, fontSize: 8, text: "REMOVE EXISTING WALL\n\nVerify dimensions before construction.\n" + "A".repeat(80), border: true };
    const layout = noteLayout(note);
    expect(layout.lines[0]).toBe("REMOVE EXISTING WALL");
    expect(layout.lines[1]).toBe("");
    expect(layout.lines.every(line => Array.from(line).length * 8 * 0.65 <= 144 - layout.padding * 2)).toBe(true);
    expect(layout.lines.join(" ").replaceAll(" ", "")).toBe(note.text.replace(/\s/g, ""));
    expect(noteLayout({ ...note, width: 72 }).height).toBeGreaterThan(layout.height);
    expect(noteLayout({ ...note, text: "\n" }).lines).toEqual(["", ""]);
    p.notes = [note];
    expect(automaticDimensions(p)).toEqual(originalDimensions);
    const visible = printBounds(p, DEFAULT_LAYERS), hidden = printBounds(p, { ...DEFAULT_LAYERS, notes: false });
    expect(visible.x + visible.width).toBeGreaterThan(note.x + note.width);
    expect(visible.y + visible.height).toBeGreaterThan(note.y + layout.height);
    expect(hidden).toEqual(printBounds({ ...p, notes: [] }, DEFAULT_LAYERS));
    expect(visible.width).toBeGreaterThan(hidden.width);
  });
  test("door hinges and swing directions survive backups and invalid hinge values are rejected", () => {
    const p = starterPlan();
    for (const hinge of ["left", "right"] as const) for (const flip of [false, true]) {
      p.openings[0] = { ...p.openings[0], hinge, flip };
      expect(parsePlan(JSON.parse(JSON.stringify(p))).openings[0]).toEqual(p.openings[0]);
    }
    const { hinge, ...legacyDoor } = p.openings[0];
    expect(parsePlan({ ...p, openings: [legacyDoor, ...p.openings.slice(1)] }).openings[0]).toEqual(legacyDoor);
    for (const invalid of ["top", null, true, 1]) {
      expect(() => parsePlan({ ...p, openings: [{ ...p.openings[0], hinge: invalid }, ...p.openings.slice(1)] })).toThrow();
    }
    expect(planFingerprint(p)).not.toBe(planFingerprint({ ...p, openings: p.openings.map((o, i) => i === 0 ? { ...o, hinge: "left" } : o) }));
  });
  test("roof type survives backups, older plans default to gable, and invalid styles are rejected", () => {
    const p = starterPlan(); p.roofType = "hip";
    expect(parsePlan(JSON.parse(JSON.stringify(p))).roofType).toBe("hip");
    const { roofType, ...legacy } = p;
    expect(parsePlan(legacy).roofType).toBe("gable");
    expect(() => parsePlan({ ...p, roofType: "shed" })).toThrow();
    expect(() => parsePlan({ ...p, roofType: null })).toThrow();
    expect(planFingerprint(p)).not.toBe(planFingerprint({ ...p, roofType: "gable" }));
  });
  test("complete plans round-trip through JSON with fixtures, utilities and finishes", () => {
    const p = starterPlan(); p.utilities.push({ id: "water", kind: "cold", a: { x: 12, y: 12 }, b: { x: 120, y: 12 } });
    p.rooms[detectRooms(p.walls)[0].id] = { name: "Bedroom", finish: "wood" };
    expect(parsePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  test("rejects malformed plans, unknown versions, invalid coordinates and dangling openings", () => {
    const p = rectangle();
    expect(() => parsePlan({ ...p, version: 2 })).toThrow();
    expect(() => parsePlan({ ...p, roofOverhang: Infinity })).toThrow();
    expect(() => parsePlan({ ...p, walls: [{ ...p.walls[0], a: { x: "12", y: 0 } }] })).toThrow();
    expect(() => parsePlan({ ...p, openings: [{ id: "bad", wallId: "missing", kind: "door", width: 36, t: 0.5, flip: false }] })).toThrow();
    expect(() => parsePlan({ ...p, fixtures: [{ id: "bad", catalogId: "bed", x: 0, y: 0, rotation: NaN, width: 60, depth: 80 }] })).toThrow();
    expect(() => parsePlan({ ...p, rooms: { room: { name: "Room", finish: "javascript" } } })).toThrow();
  });
  test("duplicate entity IDs are rejected", () => {
    const p = rectangle(); p.walls[1].id = p.walls[0].id; expect(() => parsePlan(p)).toThrow();
  });
  test("imported openings cannot extend beyond or overlap on a wall", () => {
    const p = rectangle();
    p.openings = [{ id: "a", wallId: p.walls[0].id, kind: "door", width: 36, t: 0, flip: false }];
    expect(() => parsePlan(p)).toThrow();
    p.openings[0].t = 0.5;
    p.openings.push({ ...p.openings[0], id: "b" });
    expect(() => parsePlan(p)).toThrow();
  });
  test("imperial measurements round to an eighth inch and carry feet correctly", () => {
    expect(formatLength(120)).toBe("10′ 0″"); expect(formatLength(35.5)).toBe("2′ 11½″"); expect(formatLength(11.99)).toBe("1′ 0″"); expect(formatLength(0.125)).toBe("0′ 0⅛″");
  });
});


describe("accurate paper scale", () => {
  test("fit uses standard A4 millimetres and chooses the better orientation", () => {
    const wide = printLayout({ width: 600, height: 300 }, "fit-a4");
    expect(wide.width * 25.4 / 72).toBeCloseTo(297, 10);
    expect(wide.height * 25.4 / 72).toBeCloseTo(210, 10);
    expect(wide.orientation).toBe("landscape");
    const tall = printLayout({ width: 300, height: 600 }, "fit-a4");
    expect(tall.width).toBe(A4.width);
    expect(tall.height).toBe(A4.height);
    expect(tall.orientation).toBe("portrait");
  });
  test("a 50 foot by 25 foot drawing has an exact 1:57 landscape scale", () => {
    const layout = printLayout({ width: 600, height: 300 }, "fit-a4");
    expect(layout.ratio).toBe(57);
    expect(layout.scaleLabel).toBe("1:57");
    // 10 real feet must measure 120/57 inches on the paper, on either axis.
    expect(120 * layout.pointsPerInch / 72).toBeCloseTo(120 / 57, 12);
    expect(layout.drawingWidth / 600).toBe(layout.drawingHeight / 300);
  });
  test("small, tall, wide and large drawings keep every annotation inside printer margins", () => {
    for (const box of [{ width: 41, height: 41 }, { width: 601.7, height: 301.2 }, { width: 100, height: 800 }, { width: 5000, height: 10000 }]) {
      const layout = printLayout(box, "fit-a4");
      expect(layout.x).toBeGreaterThanOrEqual(36 - 1e-8);
      expect(layout.x + layout.drawingWidth).toBeLessThanOrEqual(layout.width - 36 + 1e-8);
      expect(layout.y).toBeGreaterThanOrEqual(48 - 1e-8);
      expect(layout.y + layout.drawingHeight).toBeLessThanOrEqual(layout.height - 72 + 1e-8);
      expect(Number.isFinite(layout.ratio)).toBe(true);
    }
  });
  test("standard imperial scales preserve their physical measurements and select paper", () => {
    for (const scale of [0.25, 0.125, 0.0625] as const) {
      const layout = printLayout({ width: 600, height: 300 }, scale);
      expect(12 * layout.pointsPerInch / 72).toBe(scale);
      expect(layout.scaleLabel).toContain(`1:${12 / scale}`);
    }
    expect(printLayout({ width: 600, height: 300 }, 0.25).name).toBe("Tabloid");
    expect(printLayout({ width: 10000, height: 10000 }, 0.25).name).toBe("Custom");
  });
  test("fitting includes roof overhang and dimension chains, and ignores hidden fixtures", () => {
    const plan = rectangle(600, 300);
    const plain = printBounds(plan, { ...DEFAULT_LAYERS, dimensions: false, roof: false });
    const annotated = printBounds(plan, { ...DEFAULT_LAYERS, roof: true });
    expect(annotated.width).toBeGreaterThan(plain.width);
    expect(annotated.height).toBeGreaterThan(plain.height);
    expect(printLayout(annotated, "fit-a4").ratio).toBeGreaterThan(printLayout(plain, "fit-a4").ratio);
    const noRoof = printBounds(plan, { ...DEFAULT_LAYERS, roof: false });
    plan.roofOverhang = 120;
    expect(printBounds(plan, { ...DEFAULT_LAYERS, roof: false })).toEqual(noRoof);
    expect(printBounds(plan, { ...DEFAULT_LAYERS, roof: true }).width).toBeGreaterThan(annotated.width);
    plan.fixtures.push({ id: "distant", catalogId: "queen-bed", x: 2000, y: 0, width: 60, depth: 80, rotation: 0 });
    expect(printBounds(plan, { ...DEFAULT_LAYERS, roof: false, fixtures: false })).toEqual(noRoof);
    expect(printBounds(plan, { ...DEFAULT_LAYERS, roof: false }).width).toBeGreaterThan(2000);
  });
});
