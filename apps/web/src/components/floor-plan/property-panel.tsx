"use client";

import { Copy, FlipHorizontal, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CATALOG_MAP } from "@/lib/floor-plan/catalog";
import { bounds, distance, fitOpening, moveWallPoint, normalizeOpenings, type Room } from "@/lib/floor-plan/geometry";
import { FINISHES, formatLength, type Plan, type Selection, type TextNote } from "@/lib/floor-plan/model";

function NoteText({ note, onChange }: { note: TextNote; onChange: (text: string) => void }) {
  return <label className="fp-field"><span>Construction note</span><textarea aria-label="Construction note" rows={6} maxLength={2000} value={note.text} onChange={e => onChange(e.target.value)} autoFocus onFocus={e => { if (e.target.value === "Construction note") e.target.select(); }} placeholder="Describe the construction work…" /></label>;
}

export function NumberField({ label, value, min = -120000, max = 120000, step = 1, onChange, suffix = "in" }: {
  label: string; value: number; min?: number; max?: number; step?: number; suffix?: string; onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  const submit = () => {
    const n = Number(draft);
    if (draft.trim() !== String(Math.round(value * 1000) / 1000) && draft.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
    setDraft(String(Math.round(value * 1000) / 1000));
  };
  return <label className="fp-field"><span>{label}</span><div className="fp-number"><input aria-label={label} type="number" min={min} max={max} step={step} value={draft} onChange={e => setDraft(e.target.value)} onBlur={submit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /><span>{suffix}</span></div></label>;
}

export function PropertyPanel({ plan, selection, selections, rooms, commit, remove, duplicate, rotate, error }: {
  plan: Plan; selection: Selection | null; selections: Selection[]; rooms: Room[]; commit: (plan: Plan) => void;
  remove: () => void; duplicate: () => void; rotate: () => void; error: (message: string) => void;
}) {
  if (selections.length > 1) {
    const names = { wall: ["wall", "walls"], opening: ["opening", "openings"], fixture: ["object", "objects"], utility: ["utility run", "utility runs"], text: ["note", "notes"], room: ["room", "rooms"] };
    const counts = Object.entries(names).map(([type, name]) => { const count = selections.filter(s => s.type === type).length; return count ? `${count} ${name[count === 1 ? 0 : 1]}` : null; }).filter(Boolean);
    return <div className="fp-properties"><div className="fp-properties-heading"><span className="fp-kicker">Group selection</span><h3>{selections.length} elements selected</h3></div><p className="fp-field-note">{counts.join(" · ")}</p><p className="fp-field-note">Drag any selected element to move the group. Arrow keys nudge; Shift + arrows move 1 inch. Shift-click adds or removes an element.</p><div className="fp-property-actions"><button className="fp-button fp-danger fp-wide" onClick={remove}><Trash2 size={15} />Delete selected</button></div></div>;
  }
  if (!selection) return <div className="fp-empty-properties"><span className="fp-crosshair">⌖</span><p>Select an element<br />to edit its properties.</p><small>Click a wall, fixture, opening,<br />or room to edit its properties.</small></div>;
  const wall = selection.type === "wall" ? plan.walls.find(w => w.id === selection.id) : undefined;
  const fixture = selection.type === "fixture" ? plan.fixtures.find(f => f.id === selection.id) : undefined;
  const opening = selection.type === "opening" ? plan.openings.find(o => o.id === selection.id) : undefined;
  const utility = selection.type === "utility" ? plan.utilities.find(u => u.id === selection.id) : undefined;
  const note = selection.type === "text" ? plan.notes.find(n => n.id === selection.id) : undefined;
  const room = selection.type === "room" ? rooms.find(r => r.id === selection.id) : undefined;
  const title = wall ? `${wall.kind === "exterior" ? "Exterior" : "Interior"} wall` : fixture ? CATALOG_MAP.get(fixture.catalogId)?.name ?? "Fixture" : opening ? `${opening.kind === "door" ? "Door" : "Window"}` : room ? "Room & finish" : utility ? "Utility run" : note ? "Construction note" : "Selection";
  const updateNote = (patch: Partial<TextNote>) => commit({ ...plan, notes: plan.notes.map(n => n.id === note?.id ? { ...n, ...patch } : n) });
  const updateFixture = (patch: Partial<NonNullable<typeof fixture>>) => commit({ ...plan, fixtures: plan.fixtures.map(f => f.id === fixture?.id ? { ...f, ...patch } : f) });
  const updateOpening = (patch: Partial<NonNullable<typeof opening>>) => {
    if (!opening) return;
    const w = plan.walls.find(w => w.id === opening.wallId)!;
    const updated = { ...opening, ...patch }, t = fitOpening(w, updated.width, updated.t, plan.openings, opening.id, { kind: updated.kind, walls: plan.walls });
    if (t === null) { error("Doors and windows need 4″ of clearance from adjacent walls and must not overlap another opening."); return; }
    commit({ ...plan, openings: plan.openings.map(o => o.id === opening.id ? { ...updated, t } : o) });
  };
  return <div className="fp-properties">
    <div className="fp-properties-heading"><span className="fp-kicker">Selected element</span><h3>{title}</h3></div>
    {wall ? <>
      <label className="fp-field"><span>Wall type</span><select aria-label="Wall type" value={wall.kind} onChange={e => commit({ ...plan, walls: plan.walls.map(w => w.id === wall.id ? { ...w, kind: e.target.value as "interior" | "exterior" } : w) })}><option value="exterior">Exterior</option><option value="interior">Interior</option></select></label>
      <NumberField label="Wall thickness" value={wall.thickness} min={1} max={24} step={0.5} onChange={n => { const walls = plan.walls.map(w => w.id === wall.id ? { ...w, thickness: n } : w); commit({ ...plan, walls, openings: normalizeOpenings(walls, plan.openings) }); }} />
      <NumberField label="Wall length" value={distance(wall.a, wall.b)} min={6} max={12000} onChange={n => {
        const length = distance(wall.a, wall.b);
        commit(moveWallPoint(plan, wall.id, "b", { x: wall.a.x + (wall.b.x - wall.a.x) * n / length, y: wall.a.y + (wall.b.y - wall.a.y) * n / length }));
      }} />
      <p className="fp-field-note">{formatLength(distance(wall.a, wall.b))} · centerline measurement</p>
      <div className="fp-property-grid"><NumberField label="Start X" value={wall.a.x} onChange={n => commit(moveWallPoint(plan, wall.id, "a", { ...wall.a, x: n }))} /><NumberField label="Start Y" value={wall.a.y} onChange={n => commit(moveWallPoint(plan, wall.id, "a", { ...wall.a, y: n }))} /><NumberField label="End X" value={wall.b.x} onChange={n => commit(moveWallPoint(plan, wall.id, "b", { ...wall.b, x: n }))} /><NumberField label="End Y" value={wall.b.y} onChange={n => commit(moveWallPoint(plan, wall.id, "b", { ...wall.b, y: n }))} /></div>
      <p className="fp-field-note">Drag either endpoint to reshape. Shared corners move together. Openings follow their wall; openings that no longer fit are removed.</p>
    </> : null}
    {fixture ? <>
      <div className="fp-property-grid"><NumberField label="Width" value={fixture.width} min={1} max={600} onChange={n => updateFixture({ width: n })} /><NumberField label="Depth" value={fixture.depth} min={1} max={600} onChange={n => updateFixture({ depth: n })} /><NumberField label="Position X" value={fixture.x} onChange={n => updateFixture({ x: n })} /><NumberField label="Position Y" value={fixture.y} onChange={n => updateFixture({ y: n })} /></div>
      <NumberField label="Rotation" value={fixture.rotation} min={-3600} max={3600} suffix="°" onChange={n => updateFixture({ rotation: n })} />
      <p className="fp-field-note">Drag to move. R rotates by 90°. Arrow keys nudge by the grid spacing.</p>
    </> : null}
    {opening ? <>
      <NumberField label="Opening width" value={opening.width} min={6} max={240} onChange={n => updateOpening({ width: n })} />
      <NumberField label="Position along wall" value={opening.t * distance(plan.walls.find(w => w.id === opening.wallId)!.a, plan.walls.find(w => w.id === opening.wallId)!.b)} min={0} max={12000} onChange={n => { const w = plan.walls.find(w => w.id === opening.wallId)!; updateOpening({ t: n / distance(w.a, w.b) }); }} />
      <p className="fp-field-note">Position measures from the wall start to the center of the opening. Drag along the wall to reposition. Jambs stay at least 4″ from adjacent wall faces.</p>
      {opening.kind === "door" ? <>
        <div className="fp-door-controls">
          <button className="fp-button fp-wide" aria-pressed={opening.hinge === "right"} title={`Current hinge: ${opening.hinge ?? "left"} jamb`} onClick={() => updateOpening({ hinge: opening.hinge === "right" ? "left" : "right" })}><FlipHorizontal size={15} />Flip hinge side</button>
          <button className="fp-button fp-wide" onClick={() => updateOpening({ flip: !opening.flip })}><FlipHorizontal size={15} />Flip door swing</button>
        </div>
        <p className="fp-field-note">Hinge side and swing direction can be changed independently.</p>
      </> : null}
    </> : null}
    {utility ? <>
      <label className="fp-field"><span>System</span><select aria-label="System" value={utility.kind} onChange={e => commit({ ...plan, utilities: plan.utilities.map(u => u.id === utility.id ? { ...u, kind: e.target.value as typeof utility.kind } : u) })}><option value="electrical">Electrical circuit</option><option value="cold">Cold water</option><option value="hot">Hot water</option><option value="drain">Drain / waste</option></select></label>
      <div className="fp-property-grid">{(["a", "b"] as const).flatMap((end, i) => (["x", "y"] as const).map(axis => <NumberField key={`${end}-${axis}`} label={`${i ? "End" : "Start"} ${axis.toUpperCase()}`} value={utility[end][axis]} onChange={n => commit({ ...plan, utilities: plan.utilities.map(u => u.id === utility.id ? { ...u, [end]: { ...u[end], [axis]: n } } : u) })} />))}</div>
      <div className="fp-measure-card"><span>Run length</span><strong>{formatLength(distance(utility.a, utility.b))}</strong></div>
    </> : null}
    {note ? <>
      <NoteText key={note.id} note={note} onChange={text => updateNote({ text })} />
      <NumberField label="Textbox width" value={note.width} min={48} max={2400} onChange={width => updateNote({ width })} />
      <label className="fp-field"><span>Text size</span><select aria-label="Text size" value={note.fontSize} onChange={e => updateNote({ fontSize: Number(e.target.value) })}>{![6, 8, 10, 12].includes(note.fontSize) ? <option value={note.fontSize}>Custom</option> : null}<option value={6}>Small</option><option value={8}>Medium</option><option value={10}>Large</option><option value={12}>Extra large</option></select></label>
      <div className="fp-property-grid"><NumberField label="Position X" value={note.x} onChange={x => updateNote({ x })} /><NumberField label="Position Y" value={note.y} onChange={y => updateNote({ y })} /></div>
      <button className="fp-button fp-wide" role="switch" aria-label="Textbox border" aria-checked={note.border} onClick={() => updateNote({ border: !note.border })}>{note.border ? "Hide textbox border" : "Show textbox border"}</button>
      <p className="fp-field-note">Text wraps to fit the box. Drag the note to move it, or drag its right handle to change the width.</p>
    </> : null}
    {room ? <>
      <label className="fp-field"><span>Room name</span><input aria-label="Room name" maxLength={80} key={room.id} defaultValue={plan.rooms[room.id]?.name ?? `Room ${rooms.indexOf(room) + 1}`} onBlur={e => {
        const name = e.target.value.trim() || `Room ${rooms.indexOf(room) + 1}`;
        commit({ ...plan, rooms: { ...plan.rooms, [room.id]: { name, finish: plan.rooms[room.id]?.finish ?? "none" } } });
      }} /></label>
      <span className="fp-field-label">Floor finish</span><div className="fp-finish-list">{FINISHES.map(f => <button key={f.id} className={(plan.rooms[room.id]?.finish ?? "none") === f.id ? "is-active" : ""} onClick={() => commit({ ...plan, rooms: { ...plan.rooms, [room.id]: { name: plan.rooms[room.id]?.name ?? `Room ${rooms.indexOf(room) + 1}`, finish: f.id } } })}><span style={{ background: f.color }} />{f.name}</button>)}</div>
      <div className="fp-measure-card"><span>Usable floor area</span><strong>{room.area.toFixed(1)} <small>sq ft</small></strong><span>{formatLength(bounds(room.inner).width)} × {formatLength(bounds(room.inner).height)}</span></div>
      <p className="fp-field-note">Area uses inside wall faces. Dimensions show the room’s clear bounding width and depth.</p>
    </> : <div className="fp-property-actions">{fixture ? <button className="fp-button" onClick={rotate}><RotateCw size={15} />Rotate</button> : null}{fixture || note ? <button className="fp-button" onClick={duplicate}><Copy size={15} />Copy</button> : null}<button className="fp-button fp-danger" onClick={remove}><Trash2 size={15} />Delete</button></div>}
  </div>;
}
