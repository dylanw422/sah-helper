import { describe, expect, test } from "bun:test";
import { automaticDimensions, wallSegments } from "../apps/web/src/lib/floor-plan/dimensions";
import { displayedDimensionLayout, layoutDimensions, labelsOverlap, uniqueRoomDimensions } from "../apps/web/src/lib/floor-plan/dimension-layout";
import { bounds, detectRooms, fitOpening, moveWallPoint, moveWalls, normalizeOpenings, offsetPolygon, pointInPolygon, polygonArea, roofPolygons, snapPoint, wallFaceGeometry } from "../apps/web/src/lib/floor-plan/geometry";
import { blankPlan, DEFAULT_LAYERS, formatLength, parsePlan, starterPlan, type Point, type Wall } from "../apps/web/src/lib/floor-plan/model";
import { clientPlanError, planFingerprint } from "../apps/web/src/lib/floor-plan/client-plans";
import { roofForPolygon, roofLayouts } from "../apps/web/src/lib/floor-plan/roof";

import { A4, printBounds, printLayout } from "../apps/web/src/lib/floor-plan/print";
import { noteLayout } from "../apps/web/src/lib/floor-plan/notes";
import { parseLengthInput } from "../apps/web/src/lib/floor-plan/length-input";
import { deleteSelection, moveSelection, selectInBox, selectionBounds, visibleSelections } from "../apps/web/src/lib/floor-plan/selection";
import { dimensionEnds, editDimension } from "../apps/web/src/lib/floor-plan/edit-dimension";
import { snapFixtureToWalls } from "../apps/web/src/lib/floor-plan/fixture-snapping";
import { CATALOG } from "../apps/web/src/lib/floor-plan/catalog";
import { cabinetPlacementClear, snapCabinet } from "../apps/web/src/lib/floor-plan/cabinet-snapping";

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

describe("readable dimension labels", () => {
  test("measurements below six inches are omitted without losing measured geometry", () => {
    const dimensions = [5.875, 6, 12].map((value, i) => ({ id: `span-${i}`, a: { x: i * 100, y: 0 }, b: { x: i * 100 + value, y: 0 }, value, offset: 14, interior: true }));
    const before = JSON.stringify(dimensions);
    expect(layoutDimensions(dimensions, 5).map(mark => mark.dimension.value)).toEqual([6, 12]);
    expect(JSON.stringify(dimensions)).toBe(before);
  });
  test("small and rotated rooms retain two readable dimension sides at every zoom", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const p = rectangle();
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate({ x: w.a.x * 54 / 240, y: w.a.y * 42 / 180 }), b: rotate({ x: w.b.x * 54 / 240, y: w.b.y * 42 / 180 }) }));
      const dimensions = automaticDimensions(p), before = JSON.stringify(dimensions);
      const fit = layoutDimensions(dimensions), zoomed = layoutDimensions(dimensions, 5);
      for (const layout of [layoutDimensions(dimensions, .7), fit, zoomed]) {
        const labels = layout.flatMap(mark => mark.labelBounds ? [mark.labelBounds] : []);
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(labelsOverlap(labels[i], labels[j])).toBe(false);
        const sides = layout.filter(mark => mark.dimension.roomId && mark.labelBounds).map(mark => mark.dimension);
        expect(sides.length).toBe(2);
        const first = sides[0];
        expect(sides.some(dim => Math.abs((first.b.x - first.a.x) * (dim.b.y - dim.a.y) - (first.b.y - first.a.y) * (dim.b.x - dim.a.x)) > 1)).toBe(true);
      }
      expect(fit.filter(mark => mark.dimension.roomId).length).toBe(2);
      expect(JSON.stringify(dimensions)).toBe(before);
      for (const mark of fit.filter(mark => mark.labelBounds && mark.dimension.roomId)) {
        const resized = editDimension(p, mark.dimension.id, mark.dimension.value + 12);
        expect(automaticDimensions(resized).find(dim => dim.id === mark.dimension.id)!.value).toBeCloseTo(mark.dimension.value + 12);
      }
      const label = zoomed.find(mark => mark.dimension.roomId && mark.labelBounds)!;
      expect(automaticDimensions(editDimension(p, label.dimension.id, label.dimension.value + 12)).find(dim => dim.id === label.dimension.id)!.value).toBeCloseTo(label.dimension.value + 12);
    }
  });
  test("a gap width keeps its label when a nearby room measurement would collide", () => {
    const gap = { id: "gap", a: { x: 0, y: 0 }, b: { x: 36, y: 0 }, value: 36, offset: 0, interior: true, doorway: true, openingId: "opening" };
    const room = { id: "room", roomId: "small-room", a: { x: 0, y: 2 }, b: { x: 48, y: 2 }, value: 48, offset: 0, interior: true };
    const marks = layoutDimensions([room, gap]);
    expect(marks.find(mark => mark.dimension.id === "gap")!.labelBounds).toBeDefined();
    expect(marks.find(mark => mark.dimension.id === "room")!.dimension.hideLabel).toBe(true);
    expect(room).not.toHaveProperty("hideLabel");
  });
  test("adjoining narrow rooms each retain two measuring sides, including fractional widths", () => {
    for (const width of [36, 39.5, 54]) {
      const p = blankPlan(), points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: 84 }, { x: 0, y: 84 }];
      p.walls = points.map((a, i) => wall(`w${i}`, a, points[(i + 1) % points.length]));
      p.walls.push(wall("partition", { x: 0, y: 42 }, { x: width, y: 42 }, "interior"));
      const layout = layoutDimensions(automaticDimensions(p), .69);
      for (const room of detectRooms(p.walls)) {
        const sides = layout.filter(mark => mark.dimension.roomId === room.id && mark.labelBounds).map(mark => mark.dimension);
        expect(sides.length).toBeGreaterThanOrEqual(2);
        expect(sides.some(dim => dim.a.x === dim.b.x)).toBe(true);
        expect(sides.some(dim => dim.a.y === dim.b.y)).toBe(true);
      }
      const boxes = layout.flatMap(mark => mark.labelBounds ? [mark.labelBounds] : []);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(labelsOverlap(boxes[i], boxes[j])).toBe(false);
      if (width === 36) expect(layout.some(mark => mark.label === "30″")).toBe(true);
      if (width === 39.5) expect(layout.some(mark => mark.label === "33½″")).toBe(true);
    }
  });
  test("zooming out preserves readable text size and suppresses labels that no longer fit", () => {
    const dimensions = [24, 180].map((value, i) => ({ id: `span-${i}`, a: { x: 0, y: i * 100 }, b: { x: value, y: i * 100 }, value, offset: 14, interior: true }));
    const marks = layoutDimensions(dimensions, .5);
    expect(marks.find(mark => mark.dimension.value === 180)!.fontSize * .5).toBeCloseTo(11 - 4 / 3);
    expect(marks.find(mark => mark.dimension.value === 24)!.dimension.hideLabel).toBe(true);
  });
  test("zooming in magnifies dimension text without reducing its drawing font size", () => {
    const dimensions = [{ id: "room-side", a: { x: 0, y: 0 }, b: { x: 180, y: 0 }, value: 180, offset: 14, interior: true }, { id: "overall", a: { x: 0, y: 100 }, b: { x: 240, y: 100 }, value: 240, offset: 14, overall: true }, { id: "gap", a: { x: 0, y: 200 }, b: { x: 36, y: 200 }, value: 36, offset: 0, doorway: true, interior: true }];
    const baseline = layoutDimensions(dimensions), zoomed = layoutDimensions(dimensions, 5);
    for (let i = 0; i < baseline.length; i++) {
      expect(zoomed[i].fontSize).toBe(baseline[i].fontSize);
      expect(zoomed[i].fontSize * 5).toBeGreaterThan(baseline[i].fontSize);
      expect(zoomed[i].labelBounds).toBeDefined();
    }
  });
  test("upward exterior labels use their rendered side of the line when checking collisions", () => {
    const exterior = { id: "upward", a: { x: 0, y: 100 }, b: { x: 0, y: 0 }, value: 100, offset: 20 };
    const nearby = { id: "nearby", a: { x: -20, y: 50 }, b: { x: 20, y: 50 }, value: 40, offset: 0, interior: true };
    const marks = layoutDimensions([exterior, nearby]);
    const box = marks.find(mark => mark.dimension.id === "upward")!.labelBounds!;
    expect(box.x + box.width / 2).toBeCloseTo(20 - 4 - (11 - 4 / 3) * .35);
    expect(marks.find(mark => mark.dimension.id === "nearby")!.dimension.hideLabel).toBe(true);
  });
});

describe("opposite interior dimensions", () => {
  test("room measurements already displayed outside are omitted in every orientation", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const p = rectangle();
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const dimensions = automaticDimensions(p), before = JSON.stringify(dimensions);
      const visible = displayedDimensionLayout(dimensions);
      expect(visible.some(mark => mark.dimension.interior)).toBe(false);
      expect(visible.filter(mark => mark.labelBounds)).toHaveLength(4);
      expect(JSON.stringify(dimensions)).toBe(before);
    }
  });
  test("shorter interior spans opposite a longer exterior wall remain visible and editable", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const p = rectangle();
      p.walls[0].kind = "interior";
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls.push(wall("branch", { x: 120, y: 0 }, { x: 120, y: 60 }, "interior"));
      p.walls = p.walls.map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const inside = displayedDimensionLayout(automaticDimensions(p)).filter(mark => mark.dimension.interior && mark.labelBounds);
      expect(inside.map(mark => Math.round(mark.dimension.value)).sort((a, b) => a - b)).toEqual([60, 114, 114]);
      for (const mark of inside) {
        const moved = editDimension(p, mark.dimension.id, mark.dimension.value + 12);
        expect(automaticDimensions(moved).find(dim => dim.id === mark.dimension.id)!.value).toBeCloseTo(mark.dimension.value + 12);
      }
      p.walls = p.walls.filter(w => w.id !== "branch");
      expect(displayedDimensionLayout(automaticDimensions(p)).some(mark => mark.dimension.interior)).toBe(false);
    }
  });
  test("matching lengths at different projected positions and directions remain independent", () => {
    const exterior = { id: "exterior", a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, value: 120, offset: -36 };
    const duplicate = { ...exterior, id: "duplicate", a: { x: 120, y: 80 }, b: { x: 0, y: 80 }, interior: true, offset: 14 };
    const separate = { ...duplicate, id: "separate", a: { x: 360, y: 80 }, b: { x: 240, y: 80 } };
    const perpendicular = { ...duplicate, id: "perpendicular", a: { x: 180, y: 30 }, b: { x: 180, y: 150 } };
    expect(displayedDimensionLayout([exterior, duplicate, separate, perpendicular]).map(mark => mark.dimension.id)).toEqual(["exterior", "separate", "perpendicular"]);
  });
  test("doorway widths and small-room measurements without a readable exterior label remain visible", () => {
    const p = rectangle();
    p.openings = [{ id: "hallway", wallId: "w0", kind: "opening", t: .5, width: 36, flip: false }];
    expect(displayedDimensionLayout(automaticDimensions(p)).filter(mark => mark.dimension.doorway && mark.labelBounds).map(mark => mark.dimension.openingId)).toEqual(["hallway"]);
    const small = rectangle(36, 42);
    for (const scale of [.7, 1, 5]) {
      const marks = displayedDimensionLayout(automaticDimensions(small), scale), labels = marks.filter(mark => mark.labelBounds);
      expect(labels.some(mark => mark.dimension.a.x === mark.dimension.b.x)).toBe(true);
      expect(labels.some(mark => mark.dimension.a.y === mark.dimension.b.y)).toBe(true);
      for (const [i, mark] of labels.entries()) for (const other of labels.slice(i + 1)) expect(labelsOverlap(mark.labelBounds!, other.labelBounds!)).toBe(false);
      expect(marks.some(mark => mark.dimension.interior && mark.labelBounds)).toBe(true);
    }
  });
  test("rectangles and squares retain one span per direction in every orientation", () => {
    for (const height of [180, 240]) for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const p = rectangle(240, height);
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate(w.b), b: rotate(w.a) }));
      const dimensions = automaticDimensions(p), before = JSON.stringify(dimensions);
      const room = uniqueRoomDimensions(dimensions).filter(dim => dim.roomId);
      expect(room.length).toBe(2);
      expect(room.map(dim => Math.round(dim.value)).sort((a, b) => a - b)).toEqual([height - 6, 234]);
      expect(JSON.stringify(dimensions)).toBe(before);
    }
  });
  test("exterior faces win even when their dimensions come later", () => {
    const p = rectangle();
    p.walls[0].kind = "interior";
    p.walls[1].kind = "interior";
    const dimensions = automaticDimensions(p);
    const room = uniqueRoomDimensions(dimensions).filter(dim => dim.roomId);
    expect(room.length).toBe(2);
    expect(room.every(dim => dim.exteriorFace)).toBe(true);
    expect(room.some(dim => dim.a.y === 177 && dim.b.y === 177)).toBe(true);
    expect(room.some(dim => dim.a.x === 3 && dim.b.x === 3)).toBe(true);
    expect(uniqueRoomDimensions([...dimensions].reverse()).filter(dim => dim.roomId).map(dim => dim.id).sort()).toEqual(room.map(dim => dim.id).sort());
  });
  test("a partition keeps both split spans and the full opposite span", () => {
    const p = rectangle();
    p.walls.push(wall("branch", { x: 120, y: 180 }, { x: 120, y: 120 }, "interior"));
    const room = uniqueRoomDimensions(automaticDimensions(p)).filter(dim => dim.roomId);
    expect(room.map(dim => dim.value).sort((a, b) => a - b)).toEqual([114, 114, 174, 234]);
    expect(room.filter(dim => dim.a.y === 177 && dim.b.y === 177).length).toBe(2);
  });
  test("different opening chains preserve equal lengths at different positions", () => {
    const p = rectangle();
    p.openings = [
      { id: "north", wallId: "w0", kind: "window", width: 36, t: .25, flip: false },
      { id: "south", wallId: "w2", kind: "window", width: 36, t: .25, flip: false },
    ];
    const room = uniqueRoomDimensions(automaticDimensions(p)).filter(dim => dim.roomId);
    expect(room.filter(dim => dim.a.y === dim.b.y).map(dim => dim.value).sort((a, b) => a - b)).toEqual([36, 36, 39, 39, 159, 159]);
    expect(room.length).toBe(7);
  });
  test("different rooms and physical doorway widths remain independent", () => {
    const north = { id: "north", roomId: "a", a: { x: 0, y: 0 }, b: { x: 36, y: 0 }, value: 36, offset: 14, interior: true };
    const south = { ...north, id: "south", roomId: "b", a: { x: 36, y: 72 }, b: { x: 0, y: 72 } };
    expect(uniqueRoomDimensions([north, south]).length).toBe(2);
    expect(uniqueRoomDimensions([{ ...north, doorway: true, openingId: "north-door" }, { ...south, roomId: "a", doorway: true, openingId: "south-door" }]).length).toBe(2);
  });
});

describe("object snapping to wall faces", () => {
  const shower = { id: "shower", catalogId: "shower", x: 24, y: 24, width: 48, depth: 48, rotation: 0 };
  test("a shower fits exactly against both inside faces of a corner despite the grid", () => {
    const p = rectangle();
    expect(snapFixtureToWalls(shower, p, 10, { x: 24, y: 24 })).toEqual({ x: 27, y: 27 });
    expect(snapFixtureToWalls({ ...shower, x: 30, y: 30 }, p, 10, { x: 30, y: 30 })).toEqual({ x: 27, y: 27 });
    expect(snapFixtureToWalls({ ...shower, x: 216, y: 156 }, p, 10)).toEqual({ x: 213, y: 153 });
  });
  test("every library object snaps using its actual size and rotation", () => {
    const p = { ...blankPlan(), walls: [wall("wall", { x: 0, y: 0 }, { x: 1000, y: 0 })] };
    for (const item of CATALOG) for (const rotation of [0, 90, 180, 270]) {
      const extent = rotation % 180 === 0 ? item.depth / 2 : item.width / 2;
      const f = { id: item.id, catalogId: item.id, width: item.width, depth: item.depth, rotation, x: 500, y: extent + 6 };
      const position = snapFixtureToWalls(f, p, 10);
      expect(position.x).toBe(500);
      expect(position.y).toBeCloseTo(extent + 3, 8);
      expect(snapFixtureToWalls({ ...f, y: -f.y }, p, 10).y).toBeCloseTo(-extent - 3, 8);
    }
  });
  test("angled walls and rotated fixtures snap to their faces with no penetration", () => {
    const angle = Math.PI / 4, c = Math.cos(angle), s = Math.sin(angle);
    const transform = (p: Point) => ({ x: 80 + c * p.x - s * p.y, y: -40 + s * p.x + c * p.y });
    const p = { ...blankPlan(), walls: [wall("angled", transform({ x: 0, y: 0 }), transform({ x: 240, y: 0 }))] };
    const f = { ...shower, ...transform({ x: 120, y: 24 }), rotation: 45 };
    const position = snapFixtureToWalls(f, p, 10), expected = transform({ x: 120, y: 27 });
    expect(position.x).toBeCloseTo(expected.x, 8);
    expect(position.y).toBeCloseTo(expected.y, 8);
  });
  test("interior wall thickness is respected on either face", () => {
    const p = rectangle();
    p.walls.push({ ...wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"), thickness: 4.5 });
    expect(snapFixtureToWalls({ ...shower, x: 96, y: 90 }, p, 10).x).toBe(93.75);
    expect(snapFixtureToWalls({ ...shower, x: 144, y: 90 }, p, 10).x).toBe(146.25);
  });
  test("openings and finite wall ends do not create invisible snapping surfaces", () => {
    const p = rectangle();
    p.openings.push({ id: "door", wallId: "w0", kind: "door", width: 72, t: .5, flip: false });
    expect(snapFixtureToWalls({ ...shower, x: 120, y: 24 }, p, 10)).toEqual({ x: 120, y: 24 });
    const short = { ...blankPlan(), walls: [wall("short", { x: 0, y: 0 }, { x: 30, y: 0 })] };
    expect(snapFixtureToWalls({ ...shower, x: 90, y: 24 }, short, 10)).toEqual({ x: 90, y: 24 });
    expect(snapFixtureToWalls({ ...shower, x: 32, y: 5, width: 6, depth: 6 }, short, 10, { x: 36, y: 12 })).toEqual({ x: 36, y: 12 });
  });
  test("away from walls the grid position survives and snapping does not alter dimensions", () => {
    const p = rectangle(), before = JSON.stringify(p), dimensions = automaticDimensions(p);
    expect(snapFixtureToWalls({ ...shower, x: 111, y: 81 }, p, 10, { x: 114, y: 84 })).toEqual({ x: 114, y: 84 });
    snapFixtureToWalls(shower, p, 10);
    expect(JSON.stringify(p)).toBe(before);
    expect(automaticDimensions(p)).toEqual(dimensions);
  });
});
describe("dynamic cabinet placement", () => {
  const cabinet = { id: "new", catalogId: "cabinet", width: 24, depth: 24, x: 48, y: 15, rotation: 0 };
  test("cabinet backs and sides align exactly despite the grid", () => {
    const p = rectangle();
    p.fixtures = [{ ...cabinet, id: "existing", x: 15, y: 15 }];
    const before = JSON.stringify(p);
    const fitted = snapCabinet({ ...cabinet, x: 42, y: 18 }, p, 8, { x: 42, y: 18 });
    expect(fitted).toMatchObject({ x: 39, y: 15, width: 24, depth: 24 });
    expect(cabinetPlacementClear(fitted, p)).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
  });
  test("ordinary wall snapping keeps the full depth instead of needlessly trimming it", () => {
    const p = rectangle();
    expect(snapCabinet({ ...cabinet, x: 60, y: 12 }, p, 5)).toMatchObject({ x: 60, y: 15, width: 24, depth: 24 });
    p.fixtures = [{ ...cabinet, id: "left", x: 15 }, { ...cabinet, id: "stove", catalogId: "range", x: 84, y: 17, width: 30, depth: 28 }];
    expect(snapCabinet({ ...cabinet, x: 42, y: 18 }, p, 4.5)).toMatchObject({ x: 39, y: 15, width: 24, depth: 24 });
    expect(snapCabinet({ ...cabinet, x: 48, y: 18 }, p, 4.5)).toMatchObject({ x: 48, y: 15, width: 42, depth: 24 });
  });
  test("end cabinets shrink or expand to the remaining wall gap at any zoom", () => {
    for (const width of [42, 60]) for (const tolerance of [2, 5, 14]) {
      const p = rectangle(width, 120);
      p.fixtures = [{ ...cabinet, id: "existing", x: 15 }];
      const gap = width - 30;
      const fitted = snapCabinet({ ...cabinet, x: 27 + gap / 2, y: 15 }, p, tolerance);
      expect(fitted.width).toBe(gap);
      expect(fitted.x - fitted.width / 2).toBe(27);
      expect(fitted.x + fitted.width / 2).toBe(width - 3);
      expect(cabinetPlacementClear(fitted, p)).toBe(true);
    }
  });
  test("gaps between cabinets, stoves, refrigerators and walls use real footprints", () => {
    for (const catalogId of ["cabinet", "range", "fridge"]) {
      const p = rectangle(120, 120);
      p.fixtures = [
        { ...cabinet, id: "left", x: 15 },
        { ...cabinet, id: "right", catalogId, x: 60, y: 21, width: 30, depth: 36 },
      ];
      const fitted = snapCabinet({ ...cabinet, x: 36, y: 18 }, p, 5);
      expect(fitted).toMatchObject({ x: 36, y: 15, width: 18, depth: 24 });
      expect(cabinetPlacementClear(fitted, p)).toBe(true);
    }
    const p = rectangle(60, 120);
    p.fixtures = [{ ...cabinet, id: "fridge", catalogId: "fridge", width: 36, depth: 36, x: 39, y: 21 }];
    expect(snapCabinet({ ...cabinet, x: 12, y: 15 }, p, 5)).toMatchObject({ x: 12, y: 15, width: 18 });
  });
  test("cabinet runs follow rotated walls and object faces", () => {
    for (const angle of [Math.PI / 4, Math.PI / 2, Math.PI]) {
      const rotate = (p: Point) => ({ x: 80 + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: 60 + p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const p = rectangle(42, 120);
      p.walls = p.walls.map(w => ({ ...w, a: rotate(w.a), b: rotate(w.b) }));
      p.fixtures = [{ ...cabinet, id: "existing", ...rotate({ x: 15, y: 15 }), rotation: angle * 180 / Math.PI }];
      const fitted = snapCabinet({ ...cabinet, ...rotate({ x: 33, y: 15 }), rotation: angle * 180 / Math.PI }, p, 5);
      const expected = rotate({ x: 33, y: 15 });
      expect(fitted.x).toBeCloseTo(expected.x);
      expect(fitted.y).toBeCloseTo(expected.y);
      expect(fitted.width).toBeCloseTo(12);
      expect(cabinetPlacementClear(fitted, p)).toBe(true);
    }
  });
  test("shallow rooms fit both cabinet width and depth without crossing walls", () => {
    const p = rectangle(24, 24), fitted = snapCabinet({ ...cabinet, x: 12, y: 12 }, p, 5);
    expect(fitted).toMatchObject({ x: 12, y: 12, width: 18, depth: 18 });
    expect(cabinetPlacementClear(fitted, p)).toBe(true);
  });
  test("partially overhanging placements trim to appliance and wall faces", () => {
    const p = rectangle(240, 120);
    p.fixtures = [{ ...cabinet, id: "stove", catalogId: "range", x: 75, y: 17, width: 30, depth: 28 }];
    const besideStove = snapCabinet({ ...cabinet, x: 58, y: 15 }, p, 5);
    expect(besideStove).toMatchObject({ x: 53, y: 15, width: 14, depth: 24 });
    expect(cabinetPlacementClear(besideStove, p)).toBe(true);
    const acrossWall = snapCabinet({ ...cabinet, x: 150, y: 4 }, p, 5);
    expect(acrossWall).toMatchObject({ x: 150, y: 9.5, width: 24, depth: 13 });
    expect(cabinetPlacementClear(acrossWall, p)).toBe(true);
  });
  test("larger appliance gaps can grow cabinets while open space retains the selected size", () => {
    const p = rectangle(240, 120);
    expect(snapCabinet({ ...cabinet, x: 120, y: 72 }, p, 5)).toMatchObject({ x: 120, y: 72, width: 24, depth: 24 });
    p.fixtures = [{ ...cabinet, id: "left", x: 15 }, { ...cabinet, id: "fridge", catalogId: "fridge", x: 117, y: 21, width: 36, depth: 36 }];
    const fitted = snapCabinet({ ...cabinet, x: 63, y: 15 }, p, 5);
    expect(fitted).toMatchObject({ x: 63, y: 15, width: 72, depth: 24 });
    expect(cabinetPlacementClear(fitted, p)).toBe(true);
    const side = snapCabinet({ ...cabinet, x: 39, y: 15 }, p, 5);
    expect(side).toMatchObject({ x: 39, y: 15, width: 24, depth: 24 });
  });
  test("openings do not create phantom cabinet boundaries and occupied positions stay invalid", () => {
    const p = rectangle();
    p.openings = [{ id: "gap", kind: "opening", wallId: "w3", t: .5, width: 60, flip: false }];
    const free = snapCabinet({ ...cabinet, x: 0, y: 90 }, p, 5);
    expect(free).toMatchObject({ x: 0, y: 90, width: 24, depth: 24 });
    expect(cabinetPlacementClear(free, p)).toBe(true);
    p.fixtures.push({ ...cabinet, id: "occupied", x: 72, y: 72, width: 72, depth: 72 });
    expect(cabinetPlacementClear(snapCabinet({ ...cabinet, x: 72, y: 72 }, p, 5), p)).toBe(false);
  });
  test("dragged cabinets exclude their old footprint and legacy countertops remain cabinetry", () => {
    const p = rectangle(60, 120);
    p.fixtures = [{ ...cabinet, id: "existing", catalogId: "counter", x: 15 }, { ...cabinet, x: 90, y: 60 }];
    const fitted = snapCabinet({ ...cabinet, x: 42 }, p, 5);
    expect(fitted).toMatchObject({ x: 42, y: 15, width: 30 });
    expect(cabinetPlacementClear(fitted, p)).toBe(true);
  });
});

function rectangle(width = 240, height = 180) {
  const p = blankPlan("Test home");
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  p.walls = corners.map((a, i) => wall(`w${i}`, a, corners[(i + 1) % 4]));
  return p;
}

describe("fixed right-angle wall junctions", () => {
  const square = (walls: Wall[]) => {
    for (let i = 0; i < 4; i++) {
      const a = walls[i], b = walls[(i + 1) % 4];
      expect(a.b).toEqual(b.a);
      const ax = a.b.x - a.a.x, ay = a.b.y - a.a.y, bx = b.b.x - b.a.x, by = b.b.y - b.a.y;
      expect((ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by)).toBeCloseTo(0, 8);
    }
  };
  test("moving a wall diagonally keeps its square neighbors straight", () => {
    const p = rectangle(), moved = moveWalls(p, ["w0"], { x: 24, y: 12 });
    expect(moved.walls[0].a).toEqual({ x: 0, y: 12 });
    expect(moved.walls[0].b).toEqual({ x: 240, y: 12 });
    expect(moved.walls[1].b).toEqual(p.walls[1].b);
    square(moved.walls);
    const vertical = moveWalls(p, ["w1"], { x: 12, y: 24 });
    expect(vertical.walls[1].a).toEqual({ x: 252, y: 0 });
    expect(vertical.walls[1].b).toEqual({ x: 252, y: 180 });
    square(vertical.walls);
  });
  test("moving a corner resizes both connected wall lines without tilting them", () => {
    const p = rectangle(), moved = moveWallPoint(p, "w0", "b", { x: 300, y: 24 });
    expect(moved.walls[0].a).toEqual({ x: 0, y: 24 });
    expect(moved.walls[0].b).toEqual({ x: 300, y: 24 });
    expect(moved.walls[1].b).toEqual({ x: 300, y: 180 });
    square(moved.walls);
    expect(detectRooms(moved.walls)).toHaveLength(1);
  });
  test("square angles stay locked when the entire plan is rotated", () => {
    for (const angle of [Math.PI / 6, Math.PI / 4]) {
      const transform = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle) + 400, y: p.x * Math.sin(angle) + p.y * Math.cos(angle) - 80 });
      const p = rectangle(); p.walls = p.walls.map(w => ({ ...w, a: transform(w.a), b: transform(w.b) }));
      const target = transform({ x: 300, y: 24 }), moved = moveWallPoint(p, "w0", "b", target);
      expect(moved.walls[0].b.x).toBeCloseTo(target.x, 8);
      expect(moved.walls[0].b.y).toBeCloseTo(target.y, 8);
      square(moved.walls);
    }
  });
  test("moving perpendicular T walls keeps both endpoints on their hosts", () => {
    const p = rectangle(); p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"));
    const moved = moveWalls(p, ["partition"], { x: 24, y: 12 });
    expect(moved.walls[4].a).toEqual({ x: 144, y: 0 });
    expect(moved.walls[4].b).toEqual({ x: 144, y: 180 });
    square(moved.walls);
    expect(detectRooms(moved.walls)).toHaveLength(2);
    const corner = moveWallPoint(p, "w0", "b", { x: 300, y: 24 });
    expect(corner.walls[4].a).toEqual({ x: 120, y: 24 });
    expect(corner.walls[4].b).toEqual({ x: 120, y: 180 });
  });
  test("continuous collinear pieces move on one shared line", () => {
    const p = rectangle(); p.walls[0] = { ...p.walls[0], b: { x: 120, y: 0 } };
    p.walls.push(wall("north-extension", { x: 120, y: 0 }, { x: 240, y: 0 }));
    const moved = moveWalls(p, ["w0"], { x: 12, y: 24 });
    expect(moved.walls[0].a).toEqual({ x: 0, y: 24 });
    expect(moved.walls[0].b.y).toBe(24);
    expect(moved.walls[4].a).toEqual(moved.walls[0].b);
    expect(moved.walls[4].b).toEqual({ x: 240, y: 24 });
    expect(moved.walls[1].a).toEqual(moved.walls[4].b);
    expect(detectRooms(moved.walls)).toHaveLength(1);
  });
  test("non-square adjacent walls remain freely adjustable", () => {
    const p = blankPlan(); p.walls = [wall("a", { x: 0, y: 0 }, { x: 240, y: 0 }), wall("b", { x: 240, y: 0 }, { x: 300, y: 180 })];
    const moved = moveWallPoint(p, "a", "b", { x: 264, y: 24 });
    expect(moved.walls[0].b).toEqual({ x: 264, y: 24 });
    expect(moved.walls[1].a).toEqual(moved.walls[0].b);
    expect(moved.walls[0].a).toEqual(p.walls[0].a);
    expect(moved.walls[1].b).toEqual(p.walls[1].b);
    p.walls.push(...rectangle().walls.map(w => ({ ...w, id: `separate-${w.id}`, a: { x: w.a.x + 600, y: w.a.y }, b: { x: w.b.x + 600, y: w.b.y } })));
    const withSquareRoom = moveWallPoint(p, "a", "b", { x: 264, y: 24 });
    expect(withSquareRoom.walls.slice(0, 2)).toEqual(moved.walls);
    expect(withSquareRoom.walls.slice(2)).toEqual(p.walls.slice(2));
  });
  test("moving a wall group preserves square junctions and a whole-plan move remains a translation", () => {
    const p = rectangle();
    const group = moveSelection(p, [{ type: "wall", id: "w0" }, { type: "wall", id: "w1" }], { x: 12, y: 24 });
    expect(group.walls[0].a).toEqual({ x: 0, y: 24 });
    expect(group.walls[0].b).toEqual({ x: 252, y: 24 });
    square(group.walls);
    const all = moveSelection(p, p.walls.map(w => ({ type: "wall", id: w.id })), { x: 12, y: 24 });
    expect(all.walls).toEqual(p.walls.map(w => ({ ...w, a: { x: w.a.x + 12, y: w.a.y + 24 }, b: { x: w.b.x + 12, y: w.b.y + 24 } })));
    square(all.walls);
  });
  test("a move that collapses or reverses a square wall leaves the original drawing intact", () => {
    const p = rectangle(), before = JSON.stringify(p);
    expect(moveWallPoint(p, "w0", "b", { x: -24, y: 24 })).toBe(p);
    expect(moveWalls(p, ["w0"], { x: 0, y: 180 })).toBe(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

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
  test("moving corners keeps attached perpendicular partitions square", () => {
    const p = rectangle(); p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"));
    const moved = moveWallPoint(p, "w0", "b", { x: 300, y: 0 });
    expect(moved.walls.find(w => w.id === "w1")!.a).toEqual({ x: 300, y: 0 });
    expect(moved.walls.find(w => w.id === "partition")!.a).toEqual({ x: 120, y: 0 });
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
  test("plain hallway openings can span the entire wall between adjoining walls", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const walls = [wall("hallway", { x: 0, y: 0 }, { x: 36, y: 0 }, "interior"), wall("left", { x: 0, y: 0 }, { x: 0, y: 120 }), wall("right", { x: 36, y: 0 }, { x: 36, y: 120 })].map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const width = Math.hypot(walls[0].b.x - walls[0].a.x, walls[0].b.y - walls[0].a.y);
      expect(fitOpening(walls[0], width, .5, [], undefined, { kind: "opening", walls })).toBe(.5);
      expect(fitOpening(walls[0], width, .5, [], undefined, { kind: "door", walls })).toBeNull();
      const opening = { id: "gap", wallId: "hallway", kind: "opening" as const, t: .5, width, flip: false };
      expect(wallSegments(walls[0], { openings: [opening] })).toEqual([]);
      expect(normalizeOpenings(walls, [opening])).toEqual([opening]);
      const p = { ...blankPlan(), walls, openings: [opening] };
      expect(parsePlan(p).openings[0]).toEqual(opening);
    }
  });
  test("plain openings reach wall ends and crossing junctions while retaining width and overlap limits", () => {
    const p = rectangle(), w = p.walls[0];
    p.walls.push(wall("branch", { x: 120, y: 0 }, { x: 120, y: 90 }, "interior"));
    const context = { kind: "opening" as const, walls: p.walls };
    expect(fitOpening(w, 36, 0, [], undefined, context)! * 240).toBe(18);
    expect(fitOpening(w, 36, 1, [], undefined, context)! * 240).toBe(222);
    expect(fitOpening(w, 36, .5, [], undefined, context)).toBe(.5);
    expect(fitOpening(w, 241, .5, [], undefined, context)).toBeNull();
    const opening = { id: "gap", wallId: w.id, kind: "opening" as const, width: 36, t: 18 / 240, flip: false };
    expect(fitOpening(w, 36, 0, [opening], opening.id)).toBe(opening.t);
    expect(fitOpening(w, 36, 0, [opening], undefined, context)).toBeNull();
    const moved = moveSelection({ ...p, openings: [opening] }, [{ type: "opening", id: opening.id }], { x: 6, y: 0 });
    expect(moved.openings[0].t * 240).toBe(24);
  });
  test("openings cut actual gaps in rendered walls and dimension chains", () => {
    const p = rectangle(), w = p.walls[0];
    p.openings.push({ id: "d", wallId: w.id, kind: "door", width: 36, t: 0.5, flip: false });
    expect(wallSegments(w, p)).toEqual([{ a: { x: 0, y: 0 }, b: { x: 102, y: 0 } }, { a: { x: 138, y: 0 }, b: { x: 240, y: 0 } }]);
    expect(automaticDimensions(p).filter(d => d.id.startsWith("exterior:side:north:segment:")).map(d => d.value)).toEqual([99, 36, 99]);
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

describe("exterior dimension placement", () => {
  test("smaller exterior dimensions stop on fractional partition faces for full and dangling T walls", () => {
    for (const full of [false, true]) for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const p = rectangle();
      p.walls.push({ ...wall("partition", { x: 120, y: 0 }, { x: 120, y: full ? 180 : 60 }, "interior"), thickness: 4.5 });
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const local = (p: Point) => ({ x: p.x * Math.cos(angle) + p.y * Math.sin(angle), y: -p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const small = automaticDimensions(p).filter(dim => !dim.interior && !dim.overall && Math.abs(local(dim.a).y - 3) < .01 && Math.abs(local(dim.b).y - 3) < .01);
      expect(small.map(dim => dim.value)).toHaveLength(2);
      for (const dim of small) expect(dim.value).toBeCloseTo(114.75);
      expect(small.flatMap(dim => [local(dim.a).x, local(dim.b).x]).sort((a, b) => a - b).map(x => Math.round(x * 100) / 100)).toEqual([3, 117.75, 122.25, 237]);
      const total = automaticDimensions(p).find(dim => dim.overall && Math.abs(local(dim.a).y + 3) < .01 && Math.abs(local(dim.b).y + 3) < .01);
      if (total) expect(total.value).toBeCloseTo(246);
    }
  });
  test("smaller exterior chains measure clear space while larger totals measure outside faces", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const p = rectangle();
      p.walls[1].thickness = 8;
      p.walls[3].thickness = 10;
      p.walls.push(wall("partition", { x: 120, y: 0 }, { x: 120, y: 180 }, "interior"));
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const local = (p: Point) => ({ x: p.x * Math.cos(angle) + p.y * Math.sin(angle), y: -p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const dimensions = automaticDimensions(p);
      const north = dimensions.filter(dim => !dim.interior && Math.abs(local(dim.a).y) < 3.01 && Math.abs(local(dim.b).y) < 3.01 && Math.abs(local(dim.a).x - local(dim.b).x) > 1);
      const segments = north.filter(dim => !dim.overall).sort((a, b) => Math.min(local(a.a).x, local(a.b).x) - Math.min(local(b.a).x, local(b.b).x));
      expect(segments.map(dim => Math.round(dim.value))).toEqual([112, 113]);
      expect(Math.min(local(segments[0].a).x, local(segments[0].b).x)).toBeCloseTo(5);
      expect(Math.max(local(segments[0].a).x, local(segments[0].b).x)).toBeCloseTo(117);
      expect(Math.min(local(segments[1].a).x, local(segments[1].b).x)).toBeCloseTo(123);
      expect(Math.max(local(segments[1].a).x, local(segments[1].b).x)).toBeCloseTo(236);
      if (north.some(dim => dim.overall)) expect(north.find(dim => dim.overall)!.value).toBeCloseTo(249);
      const target = segments[0];
      for (const fixed of ["start", "end"] as const) {
        const resized = editDimension(p, target.id, target.value + 12, fixed);
        const updated = automaticDimensions(resized).find(dim => dim.id === target.id)!;
        expect(updated.value).toBeCloseTo(target.value + 12);
        expect(dimensionEnds(updated)[fixed].x).toBeCloseTo(dimensionEnds(target)[fixed].x);
        expect(dimensionEnds(updated)[fixed].y).toBeCloseTo(dimensionEnds(target)[fixed].y);
      }
    }
  });
  test("recessed smaller measurements stop on the nearest wall face for either wall direction", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const p = blankPlan(), corners = [{ x: 0, y: -120 }, { x: 360, y: -120 }, { x: 360, y: 180 }, { x: 240, y: 180 }, { x: 240, y: 0 }, { x: 0, y: 0 }];
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const local = (p: Point) => ({ x: p.x * Math.cos(angle) + p.y * Math.sin(angle), y: -p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = corners.map((a, i) => ({ ...wall(`corner${i}`, rotate(reverse ? corners[(i + 1) % corners.length] : a), rotate(reverse ? a : corners[(i + 1) % corners.length])), thickness: i === 4 ? 10.5 : 6 }));
      const dim = automaticDimensions(p).find(dim => dim.id === "wall:corner3:segment:0")!;
      expect([local(dim.a).y, local(dim.b).y].sort((a, b) => a - b)[0]).toBeCloseTo(5.25);
      expect([local(dim.a).y, local(dim.b).y].sort((a, b) => a - b)[1]).toBeCloseTo(177);
      expect(local(dim.a).x).toBeCloseTo(243);
      expect(local(dim.b).x).toBeCloseTo(243);
      expect(dim.value).toBeCloseTo(171.75);
    }
  });
  test("unfinished exterior dimensions measure their physical end caps and resize from either end", () => {
    const p = blankPlan();
    p.walls = [wall("unfinished", { x: 0, y: 0 }, { x: 120, y: 120 })];
    const dim = automaticDimensions(p).find(dim => !dim.interior)!;
    expect(dim.value).toBeCloseTo(120 * Math.SQRT2 + 6);
    for (const fixed of ["start", "end"] as const) {
      const resized = editDimension(p, dim.id, dim.value + 12, fixed);
      const updated = automaticDimensions(resized).find(d => d.id === dim.id)!;
      expect(updated.value).toBeCloseTo(dim.value + 12);
      expect(dimensionEnds(updated)[fixed].x).toBeCloseTo(dimensionEnds(dim)[fixed].x);
      expect(dimensionEnds(updated)[fixed].y).toBeCloseTo(dimensionEnds(dim)[fixed].y);
    }
  });
  test("an exterior wall made inset by another wall keeps its chain opposite the interior chain", () => {
    for (const reverse of [false, true]) {
      const p = rectangle();
      p.walls.push(wall("outer-west", { x: -48, y: 60 }, { x: -48, y: 120 }));
      if (reverse) [p.walls[3].a, p.walls[3].b] = [p.walls[3].b, p.walls[3].a];
      const dimensions = automaticDimensions(p);
      const exterior = dimensions.find(d => d.id === "wall:w3:segment:0")!;
      const interior = dimensions.find(d => d.roomId && d.a.x === 3 && d.b.x === 3)!;
      const lineX = (dim: typeof exterior) => dim.a.x - (dim.b.y - dim.a.y) / dim.value * dim.offset;
      expect(lineX(exterior)).toBe(-27);
      expect(lineX(interior)).toBe(17);
    }
  });
  test("exterior chains stay outside angled and concave footprints regardless of wall direction", () => {
    const footprints = [
      [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 180 }, { x: 0, y: 180 }],
      [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 0, y: 240 }],
    ];
    for (const corners of footprints) for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) for (const divided of [false, true]) {
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const points = corners.map(rotate), p = blankPlan();
      p.walls = points.map((a, i) => wall(`outside-${i}`, reverse ? points[(i + 1) % points.length] : a, reverse ? a : points[(i + 1) % points.length]));
      if (divided) p.walls.push(wall("partition", rotate({ x: 0, y: 60 }), rotate({ x: 240, y: 60 }), "interior"));
      const dimensions = automaticDimensions(p).filter(d => !d.interior);
      expect(dimensions.length).toBeGreaterThanOrEqual(points.length);
      for (const dim of dimensions) {
        const midpoint = { x: (dim.a.x + dim.b.x) / 2, y: (dim.a.y + dim.b.y) / 2 };
        const edge = points.findIndex((a, i) => {
          const b = points[(i + 1) % points.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const along = ((midpoint.x - a.x) * dx + (midpoint.y - a.y) * dy) / (dx * dx + dy * dy);
          return along >= 0 && along <= 1 && Math.abs(dx * (dim.b.y - dim.a.y) - dy * (dim.b.x - dim.a.x)) < .01
            && Math.abs(dx * (midpoint.y - a.y) - dy * (midpoint.x - a.x)) / Math.hypot(dx, dy) <= 3.01;
        });
        expect(edge).toBeGreaterThanOrEqual(0);
        const a = points[edge], b = points[(edge + 1) % points.length];
        const length = Math.hypot(dim.b.x - dim.a.x, dim.b.y - dim.a.y);
        const offset = { x: -(dim.b.y - dim.a.y) / length * dim.offset, y: (dim.b.x - dim.a.x) / length * dim.offset };
        // Clockwise screen-coordinate footprints have their interior to the
        // left of each directed edge; exterior chains must be to the right.
        expect((b.x - a.x) * offset.y - (b.y - a.y) * offset.x).toBeLessThan(0);
        expect(pointInPolygon({ x: midpoint.x + offset.x, y: midpoint.y + offset.y }, points)).toBe(false);
      }
    }
  });
});

describe("clear room dimensions near walls", () => {
  test("mixed straight wall runs align their inside faces and have one clear dimension", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) for (const thickness of [4.5, 5.98, 8]) {
      const p = rectangle();
      p.walls[0].b = { x: 96, y: 0 };
      p.walls.push({ ...wall("continuation", { x: 96, y: 0 }, { x: 240, y: 0 }, "interior"), thickness });
      const rotate = (p: Point) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      const local = (p: Point) => ({ x: p.x * Math.cos(angle) + p.y * Math.sin(angle), y: -p.x * Math.sin(angle) + p.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const before = JSON.stringify(p), rooms = detectRooms(p.walls), bodies = wallFaceGeometry(p.walls, rooms);
      const exterior = bodies.find(w => w.id === "w0")!, interior = bodies.find(w => w.id === "continuation")!;
      expect(local(exterior.a).y + exterior.thickness / 2).toBeCloseTo(3);
      expect(local(interior.a).y + interior.thickness / 2).toBeCloseTo(3);
      expect(interior.thickness).toBe(thickness);
      const top = automaticDimensions(p).filter(d => d.roomId && Math.abs(local(d.a).y - 3) < .01 && Math.abs(local(d.b).y - 3) < .01);
      expect(top).toHaveLength(1);
      expect(top[0].value).toBeCloseTo(234);
      expect(rooms[0].area).toBeCloseTo(234 * 174 / 144);
      expect(JSON.stringify(p)).toBe(before);
      for (const fixed of ["start", "end"] as const) {
        const resized = editDimension(p, top[0].id, 270, fixed);
        expect(automaticDimensions(resized).find(d => d.id === top[0].id)!.value).toBeCloseTo(270);
        expect(detectRooms(resized.walls)).toHaveLength(1);
      }
    }
  });
  test("openings on either part of a mixed run retain jamb chains and can be repositioned", () => {
    const p = rectangle();
    p.walls[0].b = { x: 96, y: 0 };
    p.walls.push({ ...wall("continuation", { x: 96, y: 0 }, { x: 240, y: 0 }, "interior"), thickness: 4.5 });
    p.openings = [{ id: "window", wallId: "w0", kind: "window", t: .5, width: 24, flip: false }, { id: "door", wallId: "continuation", kind: "door", t: .5, width: 36, flip: false }];
    const dimensions = automaticDimensions(p), door = dimensions.find(d => d.doorway)!;
    expect(door.a.y).toBe(.75);
    expect(door.b.y).toBe(.75);
    const top = dimensions.filter(d => d.roomId && d.a.y === 3 && d.b.y === 3);
    expect(top.map(d => d.value)).toEqual([33, 24, 90, 51]);
    const span = top.find(d => d.value === 90)!;
    const moved = editDimension(p, span.id, 96);
    expect(moved.walls).toEqual(p.walls);
    expect(moved.openings.find(o => o.id === "door")!.t * 144).toBeCloseTo(78);
    expect(automaticDimensions(moved).find(d => d.id === span.id)!.value).toBeCloseTo(96);
    const fixture = { id: "cabinet", catalogId: "cabinet", width: 24, depth: 24, rotation: 0, x: 180, y: 20 };
    expect(snapFixtureToWalls(fixture, p, 10)).toEqual({ x: 180, y: 15 });
  });
  test("mixed runs stay aligned after thickness and junction edits while perpendicular branches still split dimensions", () => {
    const p = rectangle();
    p.walls[0] = { ...p.walls[0], b: { x: 96, y: 0 }, thickness: 8 };
    p.walls.push({ ...wall("continuation", { x: 96, y: 0 }, { x: 240, y: 0 }, "interior"), thickness: 4.5 });
    const moved = moveWallPoint(p, "w0", "b", { x: 120, y: 0 });
    expect(moved.walls.find(w => w.id === "continuation")!.a).toEqual({ x: 120, y: 0 });
    const top = (plan: typeof p) => automaticDimensions(plan).filter(d => d.roomId && d.a.y === 4 && d.b.y === 4);
    expect(top(moved).map(d => d.value)).toEqual([234]);
    moved.walls.push({ ...wall("stub", { x: 160, y: 0 }, { x: 160, y: 60 }, "interior"), thickness: 4.5 });
    expect(top(moved).map(d => d.value)).toEqual([154.75, 74.75]);
    expect(detectRooms(moved.walls)).toHaveLength(1);
  });
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
  test("a T junction splits the room dimension at the partition faces", () => {
    const p = rectangle(); p.walls.push(wall("stub", { x: 120, y: 0 }, { x: 120, y: 60 }, "interior"));
    const dimensions = automaticDimensions(p), room = detectRooms(p.walls)[0];
    const top = dimensions.filter(d => d.roomId === room.id && d.a.y === 3 && d.b.y === 3);
    expect(top.map(d => [d.a.x, d.b.x, d.value])).toEqual([[3, 117, 114], [123, 237, 114]]);
    expect(dimensions.filter(d => d.roomId === room.id).map(d => d.value).sort((a, b) => a - b)).toEqual([114, 114, 174, 174, 234]);
    expect(dimensions.some(d => d.id === "wall:stub:segment:0" && d.value === 60)).toBe(true);
  });
  test("T junctions split only the affected face of an interior wall in any orientation", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) for (const reverse of [false, true]) {
      const p = rectangle();
      p.walls.push(wall("partition", { x: 0, y: 90 }, { x: 240, y: 90 }, "interior"));
      p.walls.push({ ...wall("stub", { x: 96, y: 90 }, { x: 96, y: 150 }, "interior"), thickness: 4.5 });
      const rotate = (point: Point) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
      p.walls = p.walls.map(w => ({ ...w, a: rotate(reverse ? w.b : w.a), b: rotate(reverse ? w.a : w.b) }));
      const local = (point: Point) => ({ x: point.x * Math.cos(angle) + point.y * Math.sin(angle), y: -point.x * Math.sin(angle) + point.y * Math.cos(angle) });
      const dimensions = automaticDimensions(p).filter(d => d.roomId);
      const face = (y: number) => dimensions.filter(d => Math.abs(local(d.a).y - y) < .01 && Math.abs(local(d.b).y - y) < .01).sort((a, b) => local(a.a).x - local(b.a).x);
      expect(face(87)).toHaveLength(1);
      expect(face(87)[0].value).toBeCloseTo(234);
      const split = face(93);
      expect(split).toHaveLength(2);
      expect(split[0].value).toBeCloseTo(90.75);
      expect(split[1].value).toBeCloseTo(138.75);
      expect(detectRooms(p.walls)).toHaveLength(2);
    }
  });
  test("multiple T partitions and opening jambs share a clear dimension chain", () => {
    const p = rectangle();
    p.walls.push(wall("first", { x: 72, y: 0 }, { x: 72, y: 60 }, "interior"), wall("second", { x: 168, y: 60 }, { x: 168, y: 0 }, "interior"));
    p.openings.push({ id: "window", wallId: "w0", kind: "window", width: 24, t: .5, flip: false });
    const top = automaticDimensions(p).filter(d => d.roomId && d.a.y === 3 && d.b.y === 3);
    expect(top.map(d => [d.a.x, d.b.x, d.value])).toEqual([[3, 69, 66], [75, 108, 33], [108, 132, 24], [132, 165, 33], [171, 237, 66]]);
    p.walls = p.walls.filter(w => w.id !== "first" && w.id !== "second");
    expect(automaticDimensions(p).filter(d => d.roomId && d.a.y === 3 && d.b.y === 3).map(d => d.value)).toEqual([105, 24, 105]);
  });
  test("collinear continuations and partitions on the opposite side or away from a wall do not split its room face", () => {
    const p = rectangle();
    p.walls.push(wall("outside", { x: 120, y: 0 }, { x: 120, y: -60 }, "interior"), wall("detached", { x: 180, y: 30 }, { x: 180, y: 60 }, "interior"));
    p.walls[0].b = { x: 60, y: 0 };
    p.walls.push(wall("continuation", { x: 60, y: 0 }, { x: 240, y: 0 }));
    expect(automaticDimensions(p).filter(d => d.roomId && d.a.y === 3 && d.b.y === 3).map(d => d.value)).toEqual([234]);
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
    expect(moved.walls.find(w => w.id === "w1")!.a).toEqual({ x: 294, y: 0 });
    expect(moved.walls.find(w => w.id === "w1")!.b).toEqual({ x: 294, y: 180 });
    expect(moved.walls.find(w => w.id === "w2")!.a).toEqual({ x: 294, y: 180 });
    expect(automaticDimensions(moved).find(dim => dim.id === "exterior:side:north:overall")!.value).toBe(300);
    expect(moved.walls.find(w => w.id === "partition")).toEqual(p.walls.at(-1));
    expect(detectRooms(moved.walls)).toHaveLength(2);
    expect(roofPolygons(moved)[0].some(point => point.x > 294)).toBe(true);
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
  test("split room dimensions resize a dangling T partition or the opposite boundary from either end", () => {
    const p = rectangle();
    p.walls.push(wall("stub", { x: 120, y: 0 }, { x: 120, y: 60 }, "interior"));
    const dimensions = automaticDimensions(p).filter(d => d.roomId && d.a.y === 3 && d.b.y === 3);
    expect(dimensions).toHaveLength(2);
    for (const dim of dimensions) for (const fixed of ["start", "end"] as const) {
      const originalEnds = dimensionEnds(dim), moved = editDimension(p, dim.id, 144, fixed);
      const updated = automaticDimensions(moved).find(d => d.id === dim.id)!;
      expect(updated.value).toBeCloseTo(144);
      expect(dimensionEnds(updated)[fixed]).toEqual(originalEnds[fixed]);
      const stub = moved.walls.find(w => w.id === "stub")!;
      expect(stub.a.x).toBe(stub.b.x);
      expect(stub.a.y).toBe(0);
      expect(detectRooms(moved.walls)).toHaveLength(1);
    }
  });
  test("jamb-offset edits reposition openings and adjoining wall spans keep the fixed jamb in place", () => {
    const p = rectangle();
    p.openings = [{ id: "door", wallId: "w0", kind: "door", width: 36, t: .5, flip: true }];
    const offset = editDimension(p, "exterior:side:north:segment:0", 120);
    expect(offset.walls).toEqual(p.walls);
    expect(offset.openings[0].t * 240).toBeCloseTo(141, 5);
    const wallSpan = editDimension(p, "exterior:side:north:segment:2", 120);
    expect(wallSpan.walls[1].a.x).toBe(261);
    expect(wallSpan.openings[0].t * 261).toBeCloseTo(120, 5);
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
    expect(moved.walls[0].a).toEqual({ x: 0, y: 6 });
    expect(moved.walls[0].b).toEqual({ x: 252, y: 6 });
    expect(moved.walls[1].a).toEqual(moved.walls[0].b);
    expect(moved.walls[1].b).toEqual({ x: 252, y: 180 });
    expect(moved.walls[2].a).toEqual(moved.walls[1].b);
    expect(moved.walls[3].b).toEqual(moved.walls[0].a);
    expect(moved.walls[4].a).toEqual({ x: 120, y: 6 });
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
  test("stairs preserve step counts through backups and reject fractional or invalid counts", () => {
    const p = rectangle();
    const stairs = { id: "stairs", catalogId: "stairs", width: 36, depth: 120, x: 60, y: 90, rotation: 90, steps: 18 };
    p.fixtures.push(stairs);
    expect(parsePlan(JSON.parse(JSON.stringify(p))).fixtures[0]).toEqual(stairs);
    const { steps, ...legacy } = stairs;
    expect(parsePlan({ ...p, fixtures: [legacy] }).fixtures[0].steps).toBe(12);
    for (const steps of [0, -1, 1.5, 101, NaN, Infinity, null, "12"]) expect(() => parsePlan({ ...p, fixtures: [{ ...stairs, steps }] })).toThrow();
    expect(planFingerprint(p)).not.toBe(planFingerprint({ ...p, fixtures: [{ ...stairs, steps: 19 }] }));
    expect(moveSelection(p, [{ type: "fixture", id: stairs.id }], { x: 12, y: 0 }).fixtures[0]).toMatchObject({ steps: 18, rotation: 90 });
  });
  test("plain openings preserve adjustable widths and cut wall and dimension gaps", () => {
    const p = rectangle();
    const opening = { id: "gap", wallId: "w0", kind: "opening" as const, width: 48, t: .5, flip: false };
    p.openings.push(opening);
    expect(parsePlan(JSON.parse(JSON.stringify(p))).openings[0]).toEqual(opening);
    expect(wallSegments(p.walls[0], p)).toEqual([{ a: { x: 0, y: 0 }, b: { x: 96, y: 0 } }, { a: { x: 144, y: 0 }, b: { x: 240, y: 0 } }]);
    const dimensions = automaticDimensions(p), gap = dimensions.find(d => d.openingId === opening.id && !d.hideLabel)!;
    expect(gap.value).toBe(48);
    expect(gap.offset).toBe(0);
    expect(dimensions.filter(d => d.roomId && !d.openingId && d.a.y === 3 && d.b.y === 3).map(d => d.value)).toEqual([93, 93]);
    const wider = { ...p, openings: [{ ...opening, width: 60 }] };
    expect(automaticDimensions(wider).find(d => d.openingId === opening.id)!.value).toBe(60);
    expect(moveSelection(p, [{ type: "opening", id: opening.id }], { x: 12, y: 0 }).openings[0].t).toBe(.55);
    expect(deleteSelection(p, [{ type: "opening", id: opening.id }]).openings).toEqual([]);
    expect(detectRooms(p.walls)).toHaveLength(1);
  });
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
