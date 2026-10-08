"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG_MAP } from "@/lib/floor-plan/catalog";
import { automaticDimensions, type Dimension } from "@/lib/floor-plan/dimensions";
import { layoutDimensions } from "@/lib/floor-plan/dimension-layout";
import { dimensionEnds, dimensionOpening, type FixedDimensionEnd } from "@/lib/floor-plan/edit-dimension";
import { distance, fitOpening, fixtureCorners, lerp, moveWallPoint, moveWalls, normalizeOpenings, planBounds, polygonString, project, samePoint, snapPoint } from "@/lib/floor-plan/geometry";
import { formatLength, id, type Fixture, type Layers, type Plan, type Point, type Selection, type Tool, type Utility, type Wall } from "@/lib/floor-plan/model";
import { mergeSelections, moveSelection, selectInBox, selectionBounds, selectionKey } from "@/lib/floor-plan/selection";
import { snapFixtureToWalls } from "@/lib/floor-plan/fixture-snapping";
import { cabinetPlacementClear, isCabinet, snapCabinet } from "@/lib/floor-plan/cabinet-snapping";
import { FixtureSymbol } from "./fixture-symbol";
import { DimensionInlineEditor } from "./dimension-inline-editor";
import { PlanArtwork, UTILITY_COLORS } from "./plan-artwork";

type View = { x: number; y: number; zoom: number };
type Drag = { pointerId: number; start: Point; screen: Point; snapshot: Plan; selection: Selection; selections: Selection[]; end?: "a" | "b"; moved: boolean; error?: string };
type Marquee = { pointerId: number; start: Point; screen: Point; before: Selection[]; base: Selection[]; room?: Selection; moved: boolean };
export type DrawSettings = { grid: number; snap: boolean; orthogonal: boolean; exteriorThickness: number; interiorThickness: number; doorWidth: number; windowWidth: number; openingWidth: number; length: number };
export const TOOL_HINTS: Record<Tool, string> = {
  select: "Drag empty space to select · Shift-click adds / removes · Drag selection to move · Del to delete",
  pan: "Drag to move around the drawing · Scroll to zoom",
  exterior: "Click corners or drag a wall · Esc ends the chain · Shift allows angles",
  interior: "Click corners or drag a wall · Snap to exterior walls to create rooms",
  rectangle: "Click or drag two opposite corners to create exterior walls",
  door: "Click a wall to place a door · Openings attach to the wall",
  window: "Click a wall to place a window · Openings attach to the wall",
  opening: "Click a wall to create an opening · Adjust its width in Properties",
  stairs: "Click to place stairs · R rotates · Edit the number of steps in Properties",
  fixture: "Click to place · Object edges snap to wall faces · R rotates · Esc cancels",
  text: "Click to place a construction note · Edit its text in Properties",
  electrical: "Click points to draw circuit runs · Esc ends the run",
  cold: "Click points to draw cold-water runs · Esc ends the run",
  hot: "Click points to draw hot-water runs · Esc ends the run",
  drain: "Click points to draw drain runs · Esc ends the run",
};
const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

export function PlanCanvas({ plan, tool, settings, layers, selection, selections, selectMany, catalogId, placementRotation, commit, select, error, onZoom, onTextPlaced, onDimensionApply, dimensionEditingAllowed }: {
  plan: Plan; tool: Tool; settings: DrawSettings; layers: Layers; selection: Selection | null; selections: Selection[]; catalogId: string; placementRotation: number;
  commit: (plan: Plan) => void; select: (s: Selection | null) => void; selectMany: (s: Selection[]) => void; error: (message: string) => void; onZoom: (zoom: number) => void; onTextPlaced: () => void; onDimensionApply: (id: string, inches: number, fixedEnd: FixedDimensionEnd) => void; dimensionEditingAllowed: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 150, y: 120, zoom: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const [origin, setOrigin] = useState<Point | null>(null), [hover, setHover] = useState<Point | Fixture | null>(null);
  const [preview, setPreview] = useState<Plan | null>(null), [spacePan, setSpacePan] = useState(false);
  const [editingDimension, setEditingDimension] = useState<Dimension | null>(null), [fixedEnd, setFixedEnd] = useState<FixedDimensionEnd>("start");
  const cancelDimension = useCallback((restoreFocus = false) => { setEditingDimension(null); if (restoreFocus) svgRef.current?.focus(); }, []);
  useEffect(() => { setEditingDimension(null); }, [plan.walls, plan.openings, tool, layers.dimensions, dimensionEditingAllowed]);
  const startDimensionEdit = (dim: Dimension) => {
    if (dim && !dimensionOpening(plan, dim)) { select(null); setFixedEnd("start"); setEditingDimension(dim); }
  };
  const drag = useRef<Drag | null>(null), pan = useRef<{ screen: Point; view: View; pointerId: number } | null>(null);
  const marquee = useRef<Marquee | null>(null), selectManyRef = useRef(selectMany); selectManyRef.current = selectMany;
  const [selectionBox, setSelectionBox] = useState<{ a: Point; b: Point } | null>(null);
  const drawPress = useRef<{ point: Point; screen: Point; pointerId: number } | null>(null);
  const fitted = useRef(false);
  const displayPlan = preview ?? plan;
  const placingFixture = tool === "fixture" || tool === "stairs";
  const placementCatalogId = tool === "stairs" ? "stairs" : catalogId;
  const groupBox = useMemo(() => selections.length > 1 ? selectionBounds(displayPlan, selections) : null, [displayPlan, selections]);
  const fit = useCallback(() => {
    const box = planBounds(plan), margin = 120;
    const zoom = Math.min(3, Math.max(0.1, Math.min(size.width / (box.width + margin * 2), size.height / (box.height + margin * 2))));
    setView({ x: size.width / 2 - (box.x + box.width / 2) * zoom, y: size.height / 2 - (box.y + box.height / 2) * zoom, zoom });
  }, [plan, size]);
  useEffect(() => {
    if (!svgRef.current) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect; setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(svgRef.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!fitted.current && size.width > 100 && size.height > 100) { fit(); fitted.current = true; } }, [fit, size]);
  useEffect(() => { onZoom(view.zoom); }, [view.zoom, onZoom]);
  useEffect(() => { setOrigin(null); setHover(null); setPreview(null); setSelectionBox(null); drawPress.current = null; drag.current = null; marquee.current = null; }, [tool]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && marquee.current) { marquee.current = null; setSelectionBox(null); selectManyRef.current([]); return; }
      if (isEditable(e.target)) return;
      if (e.code === "Space") { e.preventDefault(); setSpacePan(true); }
      if (e.key === "Escape") { setOrigin(null); setPreview(null); setSelectionBox(null); marquee.current = null; drag.current = null; drawPress.current = null; }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpacePan(false); };
    const blur = () => { setSpacePan(false); if (marquee.current) selectManyRef.current(marquee.current.before); marquee.current = null; setSelectionBox(null); drag.current = null; pan.current = null; drawPress.current = null; setPreview(null); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  const zoomAt = useCallback((factor: number, screen?: Point) => {
    setView(v => {
      const zoom = Math.max(0.1, Math.min(5, v.zoom * factor)), p = screen ?? { x: size.width / 2, y: size.height / 2 }, ratio = zoom / v.zoom;
      return { x: p.x - (p.x - v.x) * ratio, y: p.y - (p.y - v.y) * ratio, zoom };
    });
  }, [size]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const location = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect(), v = viewRef.current;
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return { screen, world: { x: (screen.x - v.x) / v.zoom, y: (screen.y - v.y) / v.zoom } };
  };
  const snapped = (p: Point, shift = false, start = origin) => {
    let point = settings.snap ? snapPoint(p, plan.walls, settings.grid, 10 / view.zoom, start ?? undefined, settings.orthogonal && !shift) : { ...p };
    if (!settings.snap && start && settings.orthogonal && !shift && tool !== "rectangle") {
      if (Math.abs(p.x - start.x) < Math.abs(p.y - start.y)) point.x = start.x; else point.y = start.y;
    }
    if (start && settings.length > 0 && (tool === "exterior" || tool === "interior")) {
      const length = distance(start, point);
      if (length) point = { x: start.x + (point.x - start.x) / length * settings.length, y: start.y + (point.y - start.y) / length * settings.length };
    }
    return point;
  };
  const positionFixture = (fixture: Fixture, source = plan, fallback?: Point): Fixture => {
    if (!settings.snap) return fixture;
    const gridPosition = fallback ?? { x: Math.round(fixture.x / settings.grid) * settings.grid, y: Math.round(fixture.y / settings.grid) * settings.grid };
    if (isCabinet(fixture)) return snapCabinet(fixture, source, 10 / view.zoom, gridPosition);
    return { ...fixture, ...snapFixtureToWalls(fixture, source, 10 / view.zoom, gridPosition) };
  };
  const finishSegment = (from: Point, to: Point) => {
    if (distance(from, to) < 1) return;
    if (tool === "rectangle") {
      if (Math.abs(to.x - from.x) < 6 || Math.abs(to.y - from.y) < 6) { error("A room needs at least 6 inches of width and depth."); return; }
      if (plan.walls.length + 4 > 500) { error("This plan has reached the 500-wall limit."); return; }
      const corners = [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }];
      const walls: Wall[] = corners.map((a, i) => ({ id: id(), a, b: corners[(i + 1) % 4], kind: "exterior", thickness: settings.exteriorThickness }));
      const overlaps = walls.some(w => plan.walls.some(old => (samePoint(w.a, old.a) && samePoint(w.b, old.b)) || (samePoint(w.a, old.b) && samePoint(w.b, old.a))));
      if (overlaps) { error("These walls already exist. Draw interior walls to divide a room."); return; }
      const nextWalls = [...plan.walls, ...walls];
      commit({ ...plan, walls: nextWalls, openings: normalizeOpenings(nextWalls, plan.openings) }); setOrigin(null); return;
    }
    if (tool === "exterior" || tool === "interior") {
      if (plan.walls.length >= 500) { error("This plan has reached the 500-wall limit."); return; }
      const duplicate = plan.walls.some(w => project(from, w.a, w.b).distance < 0.01 && project(to, w.a, w.b).distance < 0.01);
      if (duplicate) { error("A wall already exists along this segment."); setOrigin(to); return; }
      const wall: Wall = { id: id(), a: from, b: to, kind: tool, thickness: tool === "exterior" ? settings.exteriorThickness : settings.interiorThickness };
      const walls = [...plan.walls, wall];
      commit({ ...plan, walls, openings: normalizeOpenings(walls, plan.openings) }); setOrigin(to); return;
    }
    if (["electrical", "cold", "hot", "drain"].includes(tool)) {
      if (plan.utilities.length >= 500) { error("This plan has reached the 500-run limit."); return; }
      commit({ ...plan, utilities: [...plan.utilities, { id: id(), a: from, b: to, kind: tool as Utility["kind"] }] }); setOrigin(to);
    }
  };
  const pointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    const { screen, world } = location(e);
    if (tool === "pan" || spacePan || e.button === 1) {
      e.preventDefault(); pan.current = { screen, view, pointerId: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); return;
    }
    if (tool === "select") {
      e.preventDefault(); e.currentTarget.focus({ preventScroll: true });
      const hit = (e.target as Element).closest<SVGElement>("[data-kind][data-id]");
      const s: Selection | undefined = hit ? { type: hit.dataset.kind as Selection["type"], id: hit.dataset.id! } : undefined;
      if (!s || s.type === "room") {
        marquee.current = { pointerId: e.pointerId, start: world, screen, before: selections, base: e.shiftKey ? selections : [], room: s, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId); return;
      }
      const existing = selections.some(item => selectionKey(item) === selectionKey(s));
      if (e.shiftKey) { selectMany(existing ? selections.filter(item => selectionKey(item) !== selectionKey(s)) : mergeSelections(selections, [s])); return; }
      const next = existing && selections.length > 1 ? selections : [s];
      selectMany(next);
      drag.current = { start: world, screen, snapshot: plan, selection: s, selections: next, end: next.length === 1 ? hit?.dataset.end as "a" | "b" | undefined : undefined, pointerId: e.pointerId, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "text") {
      if (plan.notes.length >= 100) { error("This plan has reached the 100-note limit."); return; }
      const p = snapped(world, true, null), note = { id: id(), x: p.x, y: p.y, width: 144, fontSize: 8, text: "Construction note", border: true };
      commit({ ...plan, notes: [...plan.notes, note] }); select({ type: "text", id: note.id }); onTextPlaced(); return;
    }
    if (placingFixture) {
      const item = CATALOG_MAP.get(placementCatalogId); if (!item) return;
      if (plan.fixtures.length >= 1000) { error("This plan has reached the 1,000-object limit."); return; }
      const fixture = positionFixture({ id: id(), catalogId: placementCatalogId, x: world.x, y: world.y, width: item.width, depth: item.depth, rotation: placementRotation, ...(item.steps === undefined ? {} : { steps: item.steps }) });
      if (settings.snap && isCabinet(fixture) && !cabinetPlacementClear(fixture, plan)) { error("There isn't enough clear space for a cabinet here. Place it beside an object or wall."); return; }
      commit({ ...plan, fixtures: [...plan.fixtures, fixture] }); select({ type: "fixture", id: fixture.id }); return;
    }
    if (tool === "door" || tool === "window" || tool === "opening") {
      const closest = plan.walls.map(w => ({ w, p: project(world, w.a, w.b) })).sort((a, b) => a.p.distance - b.p.distance)[0];
      if (!closest || closest.p.distance > 18 / view.zoom) { error("Click directly on a wall to place an opening."); return; }
      const width = tool === "door" ? settings.doorWidth : tool === "window" ? settings.windowWidth : Math.min(settings.openingWidth, distance(closest.w.a, closest.w.b));
      if (width < 6) { error("Choose a wall at least 6″ long to create an opening."); return; }
      const t = fitOpening(closest.w, width, closest.p.t, plan.openings, undefined, { kind: tool, walls: plan.walls });
      if (t === null) { error(tool === "opening" ? "This opening overlaps another opening or extends beyond its wall. Choose another position or a smaller width." : "Doors and windows need 4″ of clearance from adjacent walls and must not overlap another opening."); return; }
      const opening = { id: id(), wallId: closest.w.id, kind: tool, width, t, flip: false, ...(tool === "door" ? { hinge: "left" as const } : {}) };
      commit({ ...plan, openings: [...plan.openings, opening] }); select({ type: "opening", id: opening.id }); return;
    }
    const p = snapped(world, e.shiftKey, tool === "rectangle" ? null : origin); setHover(p);
    if (origin) { finishSegment(origin, p); drawPress.current = null; }
    else { setOrigin(p); drawPress.current = { point: p, screen, pointerId: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }
  };
  const pointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const { screen, world } = location(e);
    if (pan.current) {
      const p = pan.current; setView({ ...p.view, x: p.view.x + screen.x - p.screen.x, y: p.view.y + screen.y - p.screen.y }); return;
    }
    const m = marquee.current;
    if (m) {
      if (distance(screen, m.screen) < 3 && !m.moved) return;
      m.moved = true; setSelectionBox({ a: m.start, b: world });
      selectMany(mergeSelections(m.base, selectInBox(plan, m.start, world, layers))); return;
    }
    const d = drag.current;
    if (d) {
      if (distance(screen, d.screen) < 3 && !d.moved) return;
      d.moved = true;
      const snapshot = d.snapshot;
      const delta = { x: world.x - d.start.x, y: world.y - d.start.y };
      const quantize = (n: number) => settings.snap ? Math.round(n / settings.grid) * settings.grid : n;
      delta.x = quantize(delta.x); delta.y = quantize(delta.y);
      if (d.selections.length > 1) {
        try { setPreview(moveSelection(snapshot, d.selections, delta)); d.error = undefined; }
        catch (e) { setPreview(null); d.error = e instanceof Error ? e.message : "The selection could not be moved."; }
      } else if (d.selection.type === "fixture") {
        const f = snapshot.fixtures.find(f => f.id === d.selection.id)!;
        const moved = positionFixture({ ...f, x: f.x + world.x - d.start.x, y: f.y + world.y - d.start.y }, snapshot, { x: f.x + delta.x, y: f.y + delta.y });
        if (settings.snap && isCabinet(moved) && !cabinetPlacementClear(moved, snapshot)) { setPreview(null); d.error = "The cabinet needs clear space between walls and objects."; return; }
        d.error = undefined;
        setPreview({ ...snapshot, fixtures: snapshot.fixtures.map(item => item.id === f.id ? moved : item) });
      } else if (d.selection.type === "text") {
        setPreview({ ...snapshot, notes: snapshot.notes.map(n => n.id === d.selection.id ? d.end ? { ...n, width: Math.max(48, Math.min(2400, n.width + delta.x)) } : { ...n, x: n.x + delta.x, y: n.y + delta.y } : n) });
      } else if (d.selection.type === "wall") {
        const w = snapshot.walls.find(w => w.id === d.selection.id)!;
        if (d.end) {
          const point = settings.snap ? snapPoint(world, snapshot.walls, settings.grid, 10 / view.zoom, undefined, false, [w.id]) : world;
          setPreview(moveWallPoint(snapshot, w.id, d.end, point));
        } else {
          setPreview(moveWalls(snapshot, [w.id], delta));
        }
      } else if (d.selection.type === "opening") {
        const o = snapshot.openings.find(o => o.id === d.selection.id)!, w = snapshot.walls.find(w => w.id === o.wallId)!;
        const t = fitOpening(w, o.width, project(world, w.a, w.b).t, snapshot.openings, o.id, { kind: o.kind, walls: snapshot.walls });
        if (t !== null) setPreview({ ...snapshot, openings: snapshot.openings.map(item => item.id === o.id ? { ...item, t } : item) });
      } else if (d.selection.type === "utility") {
        setPreview({ ...snapshot, utilities: snapshot.utilities.map(u => u.id === d.selection.id ? { ...u, a: { x: u.a.x + delta.x, y: u.a.y + delta.y }, b: { x: u.b.x + delta.x, y: u.b.y + delta.y } } : u) });
      }
      return;
    }
    const item = placingFixture ? CATALOG_MAP.get(placementCatalogId) : undefined;
    setHover(item ? positionFixture({ id: "preview", catalogId: placementCatalogId, x: world.x, y: world.y, width: item.width, depth: item.depth, rotation: placementRotation }) : snapped(world, e.shiftKey, tool === "rectangle" || tool === "text" ? null : origin));
  };
  const pointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (marquee.current?.moved || drag.current?.selections.length && drag.current.selections.length > 1) {
      const canvas = e.currentTarget;
      requestAnimationFrame(() => { if (canvas.isConnected) canvas.focus({ preventScroll: true }); });
    }
    if (drag.current?.error) error(drag.current.error);
    if (drag.current?.moved && preview) commit(preview);
    const m = marquee.current;
    if (m) {
      if (m.moved) selectMany(mergeSelections(m.base, selectInBox(plan, m.start, location(e).world, layers)));
      else if (!m.base.length) select(m.room ?? null);
      marquee.current = null; setSelectionBox(null);
    }
    if (drawPress.current) {
      const press = drawPress.current, { screen, world } = location(e);
      if (distance(screen, press.screen) > 6) finishSegment(press.point, snapped(world, e.shiftKey, tool === "rectangle" ? null : press.point));
    }
    drag.current = null; pan.current = null; drawPress.current = null; setPreview(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const item = CATALOG_MAP.get(placementCatalogId);
  const previewWidth = hover && "width" in hover ? hover.width : item?.width ?? 0;
  const previewDepth = hover && "depth" in hover ? hover.depth : item?.depth ?? 0;
  const grid = settings.grid;
  const minor = grid * view.zoom >= 5 ? grid : grid * Math.ceil(5 / (grid * view.zoom));
  const major = Math.max(12, minor * Math.ceil(24 / minor));
  const rectangle = origin && hover ? [{ x: origin.x, y: origin.y }, { x: hover.x, y: origin.y }, { x: hover.x, y: hover.y }, { x: origin.x, y: hover.y }] : [];
  const lineTool = ["exterior", "interior", "electrical", "cold", "hot", "drain"].includes(tool);
  const cursor = spacePan || tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
  const dimensionLine = editingDimension ? (() => {
    const mark = layoutDimensions(automaticDimensions(plan), view.zoom).find(mark => mark.dimension.id === editingDimension.id);
    const d = mark?.dimension ?? editingDimension, length = distance(d.a, d.b);
    const offset = { x: -(d.b.y - d.a.y) / length * d.offset, y: (d.b.x - d.a.x) / length * d.offset };
    const a = { x: d.a.x + offset.x, y: d.a.y + offset.y }, b = { x: d.b.x + offset.x, y: d.b.y + offset.y };
    const ends = dimensionEnds({ ...d, a, b });
    const mid = mark?.labelPosition ?? lerp(a, b, 0.5);
    return { a, b, moving: ends[fixedEnd === "start" ? "end" : "start"], mid };
  })() : null;
  const horizontalRuler = useMemo(() => {
    const step = view.zoom > 1 ? 24 : view.zoom > 0.4 ? 48 : 120;
    const start = Math.floor(-view.x / view.zoom / step) * step;
    const ticks = [];
    for (let x = start; x < (size.width - view.x) / view.zoom; x += step) ticks.push(x);
    return ticks;
  }, [size.width, view]);
  return <div className="fp-canvas-wrap">
    <svg ref={svgRef} className="fp-canvas" aria-label="Floor plan drawing canvas" role="application" tabIndex={0} style={{ cursor, touchAction: "none" }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { if (marquee.current) selectMany(marquee.current.before); marquee.current = null; setSelectionBox(null); drag.current = null; pan.current = null; drawPress.current = null; setPreview(null); }} onPointerLeave={() => { if (!drag.current && !pan.current && !drawPress.current && !marquee.current) setHover(null); }} onContextMenu={e => e.preventDefault()}>
      <defs><pattern id="draft-minor" width={minor} height={minor} patternUnits="userSpaceOnUse"><path d={`M${minor} 0H0V${minor}`} fill="none" stroke="#252732" strokeWidth={0.6 / view.zoom} /></pattern><pattern id="draft-major" width={major} height={major} patternUnits="userSpaceOnUse"><rect width={major} height={major} fill="url(#draft-minor)" /><path d={`M${major} 0H0V${major}`} fill="none" stroke="#343743" strokeWidth={0.6 / view.zoom} /></pattern></defs>
      <rect width="100%" height="100%" fill="#14151b" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {layers.grid ? <rect x={-view.x / view.zoom} y={-view.y / view.zoom} width={size.width / view.zoom} height={size.height / view.zoom} fill="url(#draft-major)" /> : null}
        {!plan.walls.length && !plan.fixtures.length && !plan.notes.length ? <g pointerEvents="none" transform={`translate(${size.width / 2 / view.zoom - view.x / view.zoom} ${size.height / 2 / view.zoom - view.y / view.zoom})`} textAnchor="middle" fill="#a1a6bc"><text y={-24 / view.zoom} fontSize={23 / view.zoom} fontFamily="sans-serif">A home starts with a line.</text><text y={5 / view.zoom} fontSize={12 / view.zoom}>Choose Exterior wall or Rectangle to start drawing.</text><path d={`M${-12 / view.zoom},${35 / view.zoom}H${12 / view.zoom}M0,${23 / view.zoom}V${47 / view.zoom}`} stroke="#555c73" strokeWidth={1 / view.zoom} /></g> : null}
        <PlanArtwork theme="dark" plan={displayPlan} layers={layers} selection={selection} selections={selections} scale={view.zoom} onDimensionEdit={tool === "select" && !spacePan && dimensionEditingAllowed ? startDimensionEdit : undefined} />
        {groupBox && !selectionBox ? <rect data-group-selection="true" pointerEvents="none" x={groupBox.x - 6 / view.zoom} y={groupBox.y - 6 / view.zoom} width={groupBox.width + 12 / view.zoom} height={groupBox.height + 12 / view.zoom} stroke="#818cf8" strokeWidth={1 / view.zoom} strokeDasharray={`${5 / view.zoom} ${4 / view.zoom}`} fill="none" /> : null}
        {selectionBox ? <rect data-selection-marquee="true" pointerEvents="none" x={Math.min(selectionBox.a.x, selectionBox.b.x)} y={Math.min(selectionBox.a.y, selectionBox.b.y)} width={Math.abs(selectionBox.b.x - selectionBox.a.x)} height={Math.abs(selectionBox.b.y - selectionBox.a.y)} fill="#818cf8" fillOpacity="0.1" stroke="#a5a7fa" strokeWidth={1 / view.zoom} strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`} /> : null}
        {dimensionLine ? <g pointerEvents="none" stroke="#a5a7fa" fill="#14151b" strokeWidth={1.5 / view.zoom} data-dimension-edit-guide="true"><path d={`M${dimensionLine.a.x},${dimensionLine.a.y}L${dimensionLine.b.x},${dimensionLine.b.y}`} /><circle cx={dimensionLine.moving.x} cy={dimensionLine.moving.y} r={4 / view.zoom} /></g> : null}
        {hover && tool !== "select" && tool !== "pan" ? <g pointerEvents="none" stroke="#818cf8" fill="none" strokeWidth={1 / view.zoom}>
          {tool === "text" ? <g transform={`translate(${hover.x} ${hover.y})`} opacity="0.7"><rect width="144" height="28" strokeDasharray="4 2" /><text x="8" y="16" fontFamily="monospace" fontSize="8" stroke="none" fill="#818cf8">Construction note</text></g> : null}
          {origin && lineTool ? <><path d={`M${origin.x},${origin.y}L${hover.x},${hover.y}`} strokeWidth={tool === "exterior" ? settings.exteriorThickness : tool === "interior" ? settings.interiorThickness : 1.5 / view.zoom} stroke={lineTool && tool in UTILITY_COLORS ? UTILITY_COLORS[tool as Utility["kind"]] : "#818cf8"} strokeOpacity="0.6" /><g transform={`translate(${(origin.x + hover.x) / 2} ${(origin.y + hover.y) / 2 - 12 / view.zoom})`}><rect x={-50 / view.zoom} y={-14 / view.zoom} width={100 / view.zoom} height={21 / view.zoom} rx={4 / view.zoom} fill="#37395e" stroke="none" /><text textAnchor="middle" fontSize={11 / view.zoom} fill="white" stroke="none" fontFamily="monospace">{formatLength(distance(origin, hover))}</text></g></> : null}
          {origin && tool === "rectangle" ? <><polygon points={polygonString(rectangle)} fill="#818cf8" fillOpacity="0.07" strokeDasharray={`${6 / view.zoom} ${3 / view.zoom}`} strokeWidth={settings.exteriorThickness} /><text x={(origin.x + hover.x) / 2} y={(origin.y + hover.y) / 2} textAnchor="middle" fontSize={12 / view.zoom} fill="#818cf8" stroke="none">{formatLength(Math.abs(hover.x - origin.x))} × {formatLength(Math.abs(hover.y - origin.y))}</text></> : null}
          {placingFixture && item ? <g data-fixture-preview="true" transform={`translate(${hover.x} ${hover.y}) rotate(${placementRotation})`}><polygon points={polygonString(fixtureCorners({ id: "preview", catalogId: placementCatalogId, x: 0, y: 0, width: previewWidth, depth: previewDepth, rotation: 0 }))} strokeDasharray="3 2" /><g transform={`translate(${-previewWidth / 2} ${-previewDepth / 2}) scale(${previewWidth / 100} ${previewDepth / 100})`} color="#818cf8" opacity="0.5" strokeWidth="2"><FixtureSymbol symbol={item.symbol} steps={item.steps} dark /></g></g> : null}
          <circle cx={hover.x} cy={hover.y} r={4 / view.zoom} fill="#14151b" /><path d={`M${hover.x - 9 / view.zoom},${hover.y}H${hover.x + 9 / view.zoom}M${hover.x},${hover.y - 9 / view.zoom}V${hover.y + 9 / view.zoom}`} />
        </g> : null}
      </g>
      <g pointerEvents="none"><rect width={size.width} height="22" fill="#18191f" /><path d={`M0 22H${size.width}`} stroke="#343743" />{horizontalRuler.map(x => <g key={x} transform={`translate(${view.x + x * view.zoom} 0)`}><path d="M0 16V22" stroke="#555c73" /><text x="4" y="12" fontSize="9" fontFamily="monospace" fill="#7d849c">{Math.round(x / 12)}′</text></g>)}</g>
    </svg>
    {selections.length > 1 ? <output className="fp-selection-count" aria-label="Selected element count">{selections.length} selected · Drag to move · Del to delete</output> : null}
    {editingDimension && dimensionLine ? <DimensionInlineEditor key={editingDimension.id} dimension={editingDimension} fixed={fixedEnd} onFixedChange={setFixedEnd} size={size} anchor={{ x: view.x + dimensionLine.mid.x * view.zoom, y: view.y + dimensionLine.mid.y * view.zoom }} onCancel={cancelDimension} onApply={inches => { onDimensionApply(editingDimension.id, inches, fixedEnd); cancelDimension(true); }} /> : null}
    <div className="fp-canvas-label"><span className="fp-kicker">Drafting view</span><span>Level 1 <i /> inches / feet</span></div>
    <div className="fp-canvas-north" aria-label="North direction"><span>N</span><svg width="20" height="31" viewBox="0 0 20 31" aria-hidden="true"><path d="M10 0L17 20L10 16L3 20Z" fill="#939ab5" /><path d="M10 16V31" stroke="#939ab5" /></svg></div>
    <div className="fp-canvas-controls"><button aria-label="Fit plan to view" title="Fit plan to view" onClick={fit}><Maximize size={15} /></button><span /><button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)}><Minus size={15} /></button><output aria-label="Zoom percentage">{Math.round(view.zoom * 100)}%</output><button aria-label="Zoom in" onClick={() => zoomAt(1.2)}><Plus size={15} /></button></div>
    <div className="fp-canvas-hint">{origin ? "Drawing · Click next point · Esc to finish" : TOOL_HINTS[tool]}</div>
    <div className="fp-coordinates">{hover ? `X ${formatLength(hover.x)}  Y ${formatLength(hover.y)}` : "Space + drag to pan"}</div>
  </div>;
}
