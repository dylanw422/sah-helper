import { memo, useMemo } from "react";
import { CATALOG_MAP } from "@/lib/floor-plan/catalog";
import { automaticDimensions, wallSegments, type Dimension } from "@/lib/floor-plan/dimensions";
import { bounds, detectRooms, distance, fixtureCorners, lerp, pointInPolygon, polygonString, type Room } from "@/lib/floor-plan/geometry";
import { roofLayouts } from "@/lib/floor-plan/roof";
import { noteLayout } from "@/lib/floor-plan/notes";
import { formatLength, type Layers, type Plan, type Point, type Selection } from "@/lib/floor-plan/model";
import { FixtureSymbol } from "./fixture-symbol";

function artworkPalette(dark: boolean, monochrome: boolean) {
  return (night: string, paper: string, print = "#000") => monochrome ? print : dark ? night : paper;
}

export const UTILITY_COLORS = { electrical: "#b2811c", cold: "#267bab", hot: "#b65044", drain: "#7d637f" };

function labelPosition(room: Room, obstacles: ReturnType<typeof bounds>[], width: number, height: number): Point {
  const box = bounds(room.inner);
  const candidates = [room.center];
  for (let y = 1; y <= 7; y++) for (let x = 1; x <= 5; x++) candidates.push({ x: box.x + box.width * x / 6, y: box.y + box.height * y / 8 });
  let best = room.center, score = Infinity;
  for (const p of candidates) {
    const corners = [{ x: p.x - width / 2, y: p.y - height / 2 }, { x: p.x + width / 2, y: p.y - height / 2 }, { x: p.x + width / 2, y: p.y + height / 2 }, { x: p.x - width / 2, y: p.y + height / 2 }];
    if (!corners.every(c => pointInPolygon(c, room.inner))) continue;
    const overlap = obstacles.reduce((area, b) => area + Math.max(0, Math.min(p.x + width / 2, b.x + b.width + 3) - Math.max(p.x - width / 2, b.x - 3)) * Math.max(0, Math.min(p.y + height / 2, b.y + b.height + 3) - Math.max(p.y - height / 2, b.y - 3)), 0);
    const next = overlap * 100 + distance(p, room.center);
    if (next < score) { score = next; best = p; }
  }
  return best;
}

function DimensionMark({ dim, fontSize, dark, monochrome, scale, onEdit }: { dim: Dimension; fontSize: number; dark: boolean; monochrome: boolean; scale: number; onEdit?: (id: string) => void }) {
  const paint = artworkPalette(dark, monochrome);
  const length = distance(dim.a, dim.b);
  if (length < 0.5) return null;
  const nx = -(dim.b.y - dim.a.y) / length, ny = (dim.b.x - dim.a.x) / length;
  const a = { x: dim.a.x + nx * dim.offset, y: dim.a.y + ny * dim.offset }, b = { x: dim.b.x + nx * dim.offset, y: dim.b.y + ny * dim.offset };
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  const mid = lerp(a, b, 0.5), label = formatLength(dim.value);
  const labelFontSize = dim.doorway ? Math.min(fontSize, Math.max(1, length - 4) / (label.length * 0.62)) : fontSize;
  const hitWidth = Math.max(label.length * labelFontSize * 0.7 + 8 / scale, 28 / scale), hitHeight = Math.max(labelFontSize * 1.8, 22 / scale);
  const hitTop = (dim.interior ? 0 : -4) - hitHeight / 2;
  const activate = (e: React.PointerEvent<SVGElement>) => { e.preventDefault(); e.stopPropagation(); onEdit?.(dim.id); };
  return <g className="fp-dimension" fill="none" stroke={dim.overall ? paint("#c5c9dc", "#345955") : paint("#a1a6bc", "#6d827e")} strokeWidth="0.6" pointerEvents="none" data-dimension={dim.id} data-room-dimension={dim.roomId} data-opening-dimension={dim.openingId} data-doorway-dimension={dim.doorway ? dim.openingId : undefined}>
    <path d={dim.doorway ? `M${a.x},${a.y}L${b.x},${b.y}` : `M${dim.a.x + nx * (dim.roomId ? 2 : 8)},${dim.a.y + ny * (dim.roomId ? 2 : 8)}L${a.x + nx * 4},${a.y + ny * 4}M${dim.b.x + nx * (dim.roomId ? 2 : 8)},${dim.b.y + ny * (dim.roomId ? 2 : 8)}L${b.x + nx * 4},${b.y + ny * 4}M${a.x},${a.y}L${b.x},${b.y}`} />
    {[a, b].map((p, i) => <path key={i} d={`M${p.x - 2},${p.y + 2}L${p.x + 2},${p.y - 2}`} strokeWidth="1.2" />)}
    {onEdit && !dim.hideLabel ? <path d={`M${a.x},${a.y}L${b.x},${b.y}`} stroke="transparent" strokeWidth={10 / scale} pointerEvents="stroke" style={{ cursor: "pointer" }} onPointerDown={activate} /> : null}
    {!dim.hideLabel ? <g transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`} textAnchor="middle" fontFamily="monospace" fill={paint("#c9ccda", "#34564e")} stroke={paint("#1c1e25", "#fafbf7", "#fff")} strokeWidth="3" paintOrder="stroke" pointerEvents={onEdit ? "all" : "none"} data-edit-dimension={onEdit ? dim.id : undefined} role={onEdit ? "button" : undefined} tabIndex={onEdit ? 0 : undefined} aria-label={onEdit ? `Edit dimension ${label}` : undefined} style={onEdit ? { cursor: "pointer" } : undefined} onPointerDown={onEdit ? activate : undefined} onKeyDown={onEdit ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onEdit(dim.id); } } : undefined}>
      {onEdit ? <path d={`M${-hitWidth / 2} ${hitTop}h${hitWidth}v${hitHeight}h${-hitWidth}Z`} fill="transparent" stroke="none" /> : null}
      <text y={dim.interior ? 0 : -4} dominantBaseline={dim.interior ? "central" : undefined} fontSize={labelFontSize} fontWeight={dim.overall ? 600 : 400}>{label}</text>
    </g> : null}
  </g>;
}

export function PlanDefs({ prefix, dark = false, monochrome = false }: { prefix: string; dark?: boolean; monochrome?: boolean }) {
  const paint = artworkPalette(dark, monochrome);
  return <defs>
    <pattern id={`${prefix}-wood`} width="12" height="72" patternUnits="userSpaceOnUse"><rect width="12" height="72" fill={paint("#2c2825", "#f3e9db", "#fff")} /><path d="M0 0V72M12 0V72M0 36H12" fill="none" stroke={paint("#494036", "#d9c7ae", "#999")} strokeWidth="0.5" /></pattern>
    <pattern id={`${prefix}-tile`} width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill={paint("#242b2c", "#eaf0ed", "#fff")} /><path d="M0 0H12V12" fill="none" stroke={paint("#3c484a", "#c6d7d0", "#999")} strokeWidth="0.5" /></pattern>
    <pattern id={`${prefix}-carpet`} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={paint("#29282e", "#ede9e2", "#fff")} /><circle cx="2" cy="2" r="0.45" fill={paint("#434149", "#c9c2b5", "#999")} /></pattern>
    <pattern id={`${prefix}-vinyl`} width="8" height="60" patternUnits="userSpaceOnUse"><rect width="8" height="60" fill={paint("#292b28", "#ebece1", "#fff")} /><path d="M0 0V60M0 30H8" stroke={paint("#42483c", "#caccb7", "#999")} strokeWidth="0.5" /></pattern>
    <pattern id={`${prefix}-concrete`} width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill={paint("#27292b", "#e7e9e7", "#fff")} /><circle cx="2" cy="3" r="0.4" fill={paint("#45494c", "#b8bfb9", "#999")} /><circle cx="5" cy="6" r="0.3" fill={paint("#45494c", "#b8bfb9", "#999")} /></pattern>
  </defs>;
}

export const PlanArtwork = memo(function PlanArtwork({ plan, layers, selection, scale = 1, prefix = "plan", rooms: suppliedRooms, theme = "paper", onDimensionEdit }: {
  plan: Plan; layers: Layers; selection?: Selection | null; scale?: number; prefix?: string; rooms?: Room[]; theme?: "paper" | "dark" | "monochrome"; onDimensionEdit?: (id: string) => void;
}) {
  const dark = theme === "dark", monochrome = theme === "monochrome";
  const paint = artworkPalette(dark, monochrome);
  const detected = useMemo(() => suppliedRooms ?? detectRooms(plan.walls), [plan.walls, suppliedRooms]);
  const roofs = useMemo(() => layers.roof ? roofLayouts(plan) : [], [plan.walls, plan.roofOverhang, plan.roofType, layers.roof]);
  const dims = useMemo(() => layers.dimensions ? automaticDimensions({ walls: plan.walls, openings: plan.openings }, detected) : [], [plan.walls, plan.openings, detected, layers.dimensions]);
  const obstacles = useMemo(() => layers.fixtures ? plan.fixtures.filter(f => CATALOG_MAP.get(f.catalogId)?.category !== "Electrical").map(f => bounds(fixtureCorners(f))) : [], [plan.fixtures, layers.fixtures]);
  const fontSize = Math.max(5, Math.min(10, 10 / scale));
  const selected = (type: Selection["type"], id: string) => selection?.type === type && selection.id === id;
  return <>
    <PlanDefs prefix={prefix} dark={dark} monochrome={monochrome} />
    <g data-layer="rooms">{detected.map(room => {
      const info = plan.rooms[room.id];
      return <polygon key={room.id} points={polygonString(room.inner)} data-kind="room" data-id={room.id}
        fill={layers.finishes && info?.finish && info.finish !== "none" ? `url(#${prefix}-${info.finish})` : paint("#1c1e25", "#fafbf7", "#fff")}
        stroke={selected("room", room.id) ? paint("#818cf8", "#0e8c7c") : "none"} strokeWidth="2" />;
    })}</g>
    {layers.roof ? <g data-layer="roof" data-roof-type={plan.roofType} pointerEvents="none" fill="none" stroke={paint("#d0ac68", "#a67d3a")} strokeWidth="1" strokeDasharray="7 4" opacity="0.5">
      {roofs.map((roof, i) => <g key={i}>
        <polygon points={polygonString(roof.perimeter)} />
        {roof.lines.map((line, j) => <path key={j} data-roof-line={line.kind} d={`M${line.a.x},${line.a.y}L${line.b.x},${line.b.y}`} strokeWidth={line.kind === "ridge" ? 1.4 : 1}><title>{line.kind === "ridge" ? "Roof ridge" : line.kind === "hip" ? "Roof hip" : "Roof valley"}</title></path>)}
      </g>)}
    </g> : null}
    <g data-layer="walls">{plan.walls.map(w => {
      const active = selected("wall", w.id);
      return <g key={w.id} data-kind="wall" data-id={w.id}>
        <path d={`M${w.a.x},${w.a.y}L${w.b.x},${w.b.y}`} stroke="transparent" strokeWidth={Math.max(w.thickness, 10 / scale)} fill="none" />
        {wallSegments(w, plan).map((segment, i) => <g key={i}>
          <path d={`M${segment.a.x},${segment.a.y}L${segment.b.x},${segment.b.y}`} stroke={active ? paint("#818cf8", "#0e8c7c") : paint("#b4b7c7", "#31463f")} strokeWidth={w.thickness + 1} strokeLinecap="square" />
          <path d={`M${segment.a.x},${segment.a.y}L${segment.b.x},${segment.b.y}`} stroke={active ? paint("#37395e", "#b9e4d8") : w.kind === "exterior" ? paint("#757988", "#61736a", "#ddd") : paint("#555966", "#a4afa5", "#ddd")} strokeWidth={Math.max(0.5, w.thickness - 1)} strokeLinecap="square" />
        </g>)}
        {active ? [w.a, w.b].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5 / scale} fill={paint("#22242c", "#fff", "#fff")} stroke={paint("#818cf8", "#0e8c7c")} strokeWidth={1.5 / scale} data-kind="wall" data-id={w.id} data-end={i ? "b" : "a"} />) : null}
      </g>;
    })}</g>
    <g data-layer="openings">{plan.openings.map(o => {
      const w = plan.walls.find(w => w.id === o.wallId);
      if (!w) return null;
      const center = lerp(w.a, w.b, o.t), angle = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180 / Math.PI;
      const color = selected("opening", o.id) ? paint("#818cf8", "#0e8c7c") : paint("#93a5c9", "#466e69");
      return <g key={o.id} transform={`translate(${center.x} ${center.y}) rotate(${angle})`} data-kind="opening" data-id={o.id} fill="none" stroke={color} strokeWidth="1">
        <rect x={-o.width / 2} y={-Math.max(w.thickness / 2, 5 / scale)} width={o.width} height={Math.max(w.thickness, 10 / scale)} fill="transparent" stroke="none" />
        {o.kind === "window" ? <><rect x={-o.width / 2} y={-w.thickness / 2} width={o.width} height={w.thickness} fill={paint("#243245", "#edf8f6", "#fff")} /><path d={`M${-o.width / 2},0H${o.width / 2}`} /></> : <g data-door-hinge={o.hinge ?? "left"} transform={`translate(${o.hinge === "right" ? o.width / 2 : -o.width / 2} 0) scale(${o.hinge === "right" ? -1 : 1} ${o.flip ? -1 : 1})`}><path d={`M0 0V${o.width}A${o.width} ${o.width} 0 0 0 ${o.width} 0`} /><path data-door-leaf="" d={`M0 0V${o.width}`} strokeWidth="2" /></g>}
        {selected("opening", o.id) ? <rect x={-o.width / 2 - 3} y={-w.thickness / 2 - 3} width={o.width + 6} height={w.thickness + 6} strokeDasharray="3 2" /> : null}
      </g>;
    })}</g>
    {layers.fixtures ? <g data-layer="fixtures">{plan.fixtures.map(f => {
      const item = CATALOG_MAP.get(f.catalogId);
      const color = monochrome ? "#000" : item?.category === "Electrical" ? paint("#d7b268", "#a47a27") : item?.category === "Plumbing" ? paint("#7cc4d4", "#357f89") : paint("#a1a7ba", "#60746a");
      return <g key={f.id} transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`} data-kind="fixture" data-id={f.id}>
        <title>{item?.name ?? f.catalogId}</title>
        <g transform={`translate(${-f.width / 2} ${-f.depth / 2}) scale(${f.width / 100} ${f.depth / 100})`} fill="none" stroke={color} color={color} strokeWidth={Math.min(8, 130 / Math.min(f.width, f.depth))}><FixtureSymbol symbol={item?.symbol ?? "cabinet"} dark={dark} monochrome={monochrome} /></g>
        <rect x={-f.width / 2} y={-f.depth / 2} width={f.width} height={f.depth} fill="transparent" stroke={selected("fixture", f.id) ? paint("#818cf8", "#0e8c7c") : "none"} strokeWidth={1.5 / scale} strokeDasharray={selected("fixture", f.id) ? `${4 / scale} ${2 / scale}` : undefined} />
      </g>;
    })}</g> : null}
    {layers.utilities ? <g data-layer="utilities">{plan.utilities.map(u => <g key={u.id} data-kind="utility" data-id={u.id}>
      <path d={`M${u.a.x},${u.a.y}L${u.b.x},${u.b.y}`} stroke="transparent" strokeWidth={12 / scale} />
      <path d={`M${u.a.x},${u.a.y}L${u.b.x},${u.b.y}`} fill="none" stroke={selected("utility", u.id) ? paint("#818cf8", "#0e8c7c") : monochrome ? "#000" : UTILITY_COLORS[u.kind]} strokeWidth={1.5 / scale} strokeDasharray={u.kind === "electrical" ? "6 3" : u.kind === "drain" ? "9 3 2 3" : monochrome && u.kind === "hot" ? "4 2" : undefined} />
      {[u.a, u.b].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2 / scale} fill={monochrome ? "#000" : UTILITY_COLORS[u.kind]} />)}
    </g>)}</g> : null}
    {layers.labels ? <g data-layer="labels" pointerEvents="none">{detected.map((room, i) => {
      const box = bounds(room.inner), info = plan.rooms[room.id];
      const maxChars = Math.max(6, Math.floor((box.width - 10) / (fontSize * 0.68)));
      const name = info?.name ?? `ROOM ${i + 1}`, nameLabel = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
      const horizontal = formatLength(box.width), vertical = formatLength(box.height), dimensionLabel = `${horizontal} × ${vertical}`;
      const split = dimensionLabel.length * fontSize * 0.5 > box.width - 16;
      const rows = [nameLabel, `${room.area.toFixed(0)} sq ft`, ...(layers.dimensions ? split ? [horizontal, vertical] : [dimensionLabel] : [])];
      const labelWidth = Math.min(box.width - 4, Math.max(...rows.map(row => row.length)) * fontSize * 0.63);
      const labelHeight = rows.length * fontSize * 1.45;
      const center = labelPosition(room, obstacles, labelWidth, labelHeight);
      return <g key={room.id} transform={`translate(${center.x} ${center.y})`} textAnchor="middle" fontFamily="monospace" fill={paint("#c9ccda", "#34564e")} stroke={paint("#1c1e25", "#fafbf7", "#fff")} strokeWidth="3" paintOrder="stroke">
        <title>{name}</title>
        {rows.map((row, index) => <text key={index} y={(index - (rows.length - 1) / 2) * fontSize * 1.45 + fontSize * 0.35} fontSize={fontSize * (index === 0 ? 1.13 : index === 1 ? 0.9 : 0.82)} fontWeight={index === 0 ? 600 : undefined}>{row}</text>)}
      </g>;
    })}</g> : null}
    {layers.dimensions ? <g data-layer="dimensions">{dims.map(dim => <DimensionMark key={dim.id} dim={dim} dark={dark} monochrome={monochrome} fontSize={fontSize * (dim.overall ? 1.3 : 1.1)} scale={scale} onEdit={onDimensionEdit} />)}</g> : null}
    {layers.notes ? <g data-layer="notes">{plan.notes.map(note => {
      const layout = noteLayout(note), active = selected("text", note.id);
      return <g key={note.id} data-kind="text" data-id={note.id} transform={`translate(${note.x} ${note.y})`}>
        <rect width={note.width} height={layout.height} fill={paint("#1c1e25", "#fafbf7", "#fff")} fillOpacity={note.border ? 1 : 0} stroke={active ? paint("#818cf8", "#0e8c7c") : note.border ? paint("#a1a6bc", "#34564e") : "none"} strokeWidth={active ? 1.5 / scale : 0.8} strokeDasharray={active ? `${4 / scale} ${2 / scale}` : undefined} />
        <text fontFamily="monospace" fontSize={note.fontSize} fill={paint("#c9ccda", "#34564e")} pointerEvents="none" xmlSpace="preserve">{layout.lines.map((line, i) => <tspan key={i} x={layout.padding} y={layout.padding + note.fontSize + i * layout.lineHeight}>{line}</tspan>)}</text>
        {active ? <rect x={note.width - 4 / scale} y={layout.height / 2 - 4 / scale} width={8 / scale} height={8 / scale} fill={paint("#22242c", "#fff", "#fff")} stroke={paint("#818cf8", "#0e8c7c")} strokeWidth={1 / scale} data-kind="text" data-id={note.id} data-end="b" style={{ cursor: "ew-resize" }} /> : null}
      </g>;
    })}</g> : null}
  </>;
});
