"use client";

import {
  Bath, BedDouble, Check, ChevronDown, ChevronRight, CircleHelp, CircuitBoard, Copy, Download,
  DoorOpen, Droplets, Eye, EyeOff, FileJson, FolderOpen, Grid2X2, Hand, House, Layers3, LayoutTemplate,
  Menu, MousePointer2, PanelRight, PencilRuler, Plus, Search, Settings2, Square, Trash2,
  Upload, X, Zap, Save, Cloud, Type,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, CATALOG_MAP, CATEGORIES, type CatalogCategory } from "@/lib/floor-plan/catalog";
import { editDimension } from "@/lib/floor-plan/edit-dimension";
import { detectRooms, distance, normalizeOpenings, planBounds, project } from "@/lib/floor-plan/geometry";
import { printBounds, printLayout, type PdfScale } from "@/lib/floor-plan/print";
import { roofLayouts } from "@/lib/floor-plan/roof";
import { DEFAULT_LAYERS, formatLength, id, parsePlan, type Layers, type Plan, type Selection, type Tool } from "@/lib/floor-plan/model";
import { FixtureSymbol } from "./fixture-symbol";
import { PlanCanvas, type DrawSettings } from "./plan-canvas";
import { NumberField, PropertyPanel } from "./property-panel";
import { usePlanDocument } from "./use-plan-document";
import { useClientPlanSaving } from "./use-client-plan-saving";
import { ClientSaveForm } from "./client-save-form";
import { SavedClientPlans } from "./saved-client-plans";
import { clientPlanError, planFingerprint, STAGE_NAMES, type ClientPlanGateway, type PlanStage, type SavedClientPlan } from "@/lib/floor-plan/client-plans";
import "./floor-plan.css";

type SidebarTab = "build" | "objects" | "systems" | "layers";
const DEFAULT_SETTINGS: DrawSettings = { grid: 6, snap: true, orthogonal: true, exteriorThickness: 6, interiorThickness: 4.5, doorWidth: 36, windowWidth: 48, length: 0 };
const TOOLS = [
  { id: "select", name: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "pan", name: "Pan", icon: Hand, shortcut: "H" },
  { id: "exterior", name: "Exterior wall", icon: House, shortcut: "E" },
  { id: "interior", name: "Interior wall", icon: PencilRuler, shortcut: "I" },
  { id: "rectangle", name: "Rectangle", icon: Square, shortcut: "B" },
  { id: "door", name: "Door", icon: DoorOpen, shortcut: "D" },
  { id: "window", name: "Window", icon: Grid2X2, shortcut: "W" },
  { id: "text", name: "Textbox", icon: Type, shortcut: "T" },
] as const;
const LAYER_NAMES: Record<keyof Layers, string> = { grid: "Drawing grid", dimensions: "Auto dimensions", roof: "Roof structure", fixtures: "Furniture & fixtures", utilities: "Utility runs", finishes: "Floor finishes", labels: "Room labels", notes: "Construction notes" };
const SYSTEMS = [
  { id: "electrical", name: "Electrical circuit", color: "#b2811c" },
  { id: "cold", name: "Cold-water supply", color: "#267bab" },
  { id: "hot", name: "Hot-water supply", color: "#b65044" },
  { id: "drain", name: "Drain / waste", color: "#7d637f" },
] as const;

function PlanName({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return <input className="fp-plan-name" aria-label="Plan name" maxLength={160} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { const next = draft.trim() || "Untitled floor plan"; setDraft(next); if (next !== name) onChange(next); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusable = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [href], [tabindex="0"]') ?? []);
    const firstInput = el?.querySelector<HTMLElement>("input");
    (firstInput ?? focusable()[0])?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); previous?.focus(); };
  }, [onClose]);
  return <div className="fp-dialog-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className="fp-dialog" role="dialog" aria-modal="true" aria-label={title}><div className="fp-dialog-heading"><div><span className="fp-kicker">SAH Helper · Plan studio</span><h2>{title}</h2></div><button className="fp-icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>{children}</div></div>;
}

export function FloorPlanEditor({ storageKey, clientPlans, initialClientId, initialPlanId, initialStage, startNew = false, onClientPlanCreated, onExit }: { storageKey: string; clientPlans?: ClientPlanGateway; initialClientId?: string; initialPlanId?: string; initialStage?: PlanStage; startNew?: boolean; onClientPlanCreated?: (id?: string) => void; onExit?: () => void }) {
  const doc = usePlanDocument(storageKey);
  const { plan, commit } = doc;
  const [tool, setTool] = useState<Tool>("select"), [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<SidebarTab>("build"), [category, setCategory] = useState<CatalogCategory>("Furniture");
  const [search, setSearch] = useState(""), [catalogId, setCatalogId] = useState("queen-bed"), [placementRotation, setPlacementRotation] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS), [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [zoom, setZoom] = useState(1), [leftOpen, setLeftOpen] = useState(false), [rightOpen, setRightOpen] = useState(false);
  const [modal, setModal] = useState<"new" | "projects" | "help" | "export" | "save-client" | "exit" | null>(null);
  const [exiting, setExiting] = useState(false), [exitError, setExitError] = useState(""), [exitDraftSaved, setExitDraftSaved] = useState(false);
  const exitAttempt = useRef(0);
  useEffect(() => () => { exitAttempt.current++; }, []);
  const [newName, setNewName] = useState("New floor plan"), [newTemplate, setNewTemplate] = useState<"blank" | "sample">("blank");
  const [deleteId, setDeleteId] = useState<string | null>(null), [pdfScale, setPdfScale] = useState<PdfScale>("fit-a4"), [exportBusy, setExportBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const cloud = useClientPlanSaving(plan, storageKey, clientPlans, doc.ready, modal !== null || loadingPlan);
  const routeOpened = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const rooms = useMemo(() => detectRooms(plan.walls), [plan.walls]);
  const roofs = useMemo(() => roofLayouts(plan), [plan.walls, plan.roofOverhang, plan.roofType]);
  const totalArea = rooms.reduce((sum, room) => sum + room.area, 0);
  const box = useMemo(() => planBounds(plan), [plan.walls, plan.fixtures, plan.utilities, plan.notes]);
  const exportLayout = useMemo(() => modal === "export" ? printLayout(printBounds(plan, layers), pdfScale) : null, [modal, plan, layers, pdfScale]);
  const routeToPlan = (savedId?: string) => { routeOpened.current = `${savedId ?? ""}:::false`; onClientPlanCreated?.(savedId); };
  const closeModal = useCallback(() => { exitAttempt.current++; setExiting(false); setModal(null); setDeleteId(null); }, []);
  const error = useCallback((message: string) => setNotice({ message, kind: "error" }), []);
  const success = (message: string) => setNotice({ message, kind: "success" });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000); return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { setSelection(null); setTool("select"); }, [plan.id]);
  useEffect(() => {
    if (!selection) return;
    const items = selection.type === "wall" ? plan.walls : selection.type === "opening" ? plan.openings : selection.type === "fixture" ? plan.fixtures : selection.type === "utility" ? plan.utilities : selection.type === "text" ? plan.notes : rooms;
    if (!items.some(item => item.id === selection.id)) setSelection(null);
  }, [plan, rooms, selection]);
  const chooseTool = (next: Tool) => { setTool(next); if (next !== "select") setSelection(null); };
  const remove = () => {
    if (!selection || selection.type === "room") return;
    const sid = selection.id;
    commit({ ...plan,
      walls: selection.type === "wall" ? plan.walls.filter(w => w.id !== sid) : plan.walls,
      openings: plan.openings.filter(o => !(selection.type === "opening" && o.id === sid) && !(selection.type === "wall" && o.wallId === sid)),
      fixtures: selection.type === "fixture" ? plan.fixtures.filter(f => f.id !== sid) : plan.fixtures,
      utilities: selection.type === "utility" ? plan.utilities.filter(u => u.id !== sid) : plan.utilities,
      notes: selection.type === "text" ? plan.notes.filter(n => n.id !== sid) : plan.notes,
    }); setSelection(null);
  };
  const duplicate = () => {
    if (selection?.type === "text") {
      if (plan.notes.length >= 100) { error("This plan has reached the 100-note limit."); return; }
      const note = plan.notes.find(n => n.id === selection.id);
      if (note) { const copied = { ...note, id: id(), x: note.x + 12, y: note.y + 12 }; commit({ ...plan, notes: [...plan.notes, copied] }); setSelection({ type: "text", id: copied.id }); }
      return;
    }
    if (selection?.type !== "fixture") return;
    if (plan.fixtures.length >= 1000) { error("This plan has reached the 1,000-object limit."); return; }
    const fixture = plan.fixtures.find(f => f.id === selection.id);
    if (!fixture) return;
    const copied = { ...fixture, id: id(), x: fixture.x + 12, y: fixture.y + 12 };
    commit({ ...plan, fixtures: [...plan.fixtures, copied] }); setSelection({ type: "fixture", id: copied.id });
  };
  const rotateSelection = () => {
    if (selection?.type === "fixture") commit({ ...plan, fixtures: plan.fixtures.map(f => f.id === selection.id ? { ...f, rotation: (f.rotation + 90) % 360 } : f) });
  };
  const rotate = () => {
    if (tool === "fixture") setPlacementRotation(r => (r + 90) % 360);
    else rotateSelection();
  };
  const nudge = (key: string, precise: boolean) => {
    if (!selection || selection.type === "room" || selection.type === "opening") return;
    const amount = precise ? 1 : settings.grid;
    const dx = key === "ArrowLeft" ? -amount : key === "ArrowRight" ? amount : 0, dy = key === "ArrowUp" ? -amount : key === "ArrowDown" ? amount : 0;
    if (selection.type === "fixture") commit({ ...plan, fixtures: plan.fixtures.map(f => f.id === selection.id ? { ...f, x: f.x + dx, y: f.y + dy } : f) });
    if (selection.type === "text") commit({ ...plan, notes: plan.notes.map(n => n.id === selection.id ? { ...n, x: n.x + dx, y: n.y + dy } : n) });
    if (selection.type === "utility") commit({ ...plan, utilities: plan.utilities.map(u => u.id === selection.id ? { ...u, a: { x: u.a.x + dx, y: u.a.y + dy }, b: { x: u.b.x + dx, y: u.b.y + dy } } : u) });
    if (selection.type === "wall") {
      const wall = plan.walls.find(w => w.id === selection.id)!;
      const move = (p: { x: number; y: number }) => project(p, wall.a, wall.b).distance < 0.01 ? { x: p.x + dx, y: p.y + dy } : p;
      const walls = plan.walls.map(w => ({ ...w, a: move(w.a), b: move(w.b) }));
      if (walls.every(w => distance(w.a, w.b) >= 1)) commit({ ...plan, walls, openings: normalizeOpenings(walls, plan.openings) });
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal || loadingPlan) return;
      const target = e.target as HTMLElement;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      const modifier = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
      if (modifier && key === "z") { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); return; }
      if (modifier && key === "y") { e.preventDefault(); doc.redo(); return; }
      if (modifier && key === "d") { e.preventDefault(); duplicate(); return; }
      if (modifier) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); return; }
      if (e.key === "Escape") { chooseTool("select"); setSelection(null); setLeftOpen(false); setRightOpen(false); return; }
      if (e.key.startsWith("Arrow") && selection) { e.preventDefault(); nudge(e.key, e.shiftKey); return; }
      if (key === "r") { rotate(); return; }
      if (key === "?") { setModal("help"); return; }
      const next = TOOLS.find(t => t.shortcut.toLowerCase() === key);
      if (next) { chooseTool(next.id); if (["exterior", "interior", "rectangle", "door", "window", "text"].includes(next.id)) setTab("build"); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  });
  const select = useCallback((s: Selection | null) => { setSelection(s); }, []);
  const pickCatalogItem = (catalogId: string) => {
    setCatalogId(catalogId); chooseTool("fixture"); setPlacementRotation(0); setLayers(l => ({ ...l, fixtures: true })); setLeftOpen(false);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error("Choose a floor-plan backup smaller than 4 MB.");
      const parsed = parsePlan(JSON.parse(await file.text()));
      doc.importPlan(parsed); routeToPlan(); success("Plan imported. Your other plans are kept in the library.");
    } catch (e) { error(e instanceof Error ? e.message : "The plan could not be imported."); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const exportFile = async (kind: "json" | "svg" | "pdf") => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const exporter = await import("./export");
      const stage = cloud.link?.stage;
      const name = stage === "before" || stage === "after" ? plan.name.replace(/\s*[—-]\s*(Before|After)$/i, "") + ` — ${STAGE_NAMES[stage]}` : plan.name;
      const drawingPlan = { ...plan, name };
      if (kind === "json") exporter.downloadFile(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }), `${exporter.safeFilename(drawingPlan.name)}.sah-plan.json`);
      else if (kind === "svg") exporter.downloadFile(new Blob([exporter.planSvg(drawingPlan, layers).svg], { type: "image/svg+xml" }), `${exporter.safeFilename(drawingPlan.name)}.svg`);
      else await exporter.exportPdf(drawingPlan, layers, pdfScale);
      success(`${kind.toUpperCase()} exported.`);
    } catch (e) { error(e instanceof Error ? e.message : "Export failed. Please try again."); }
    finally { setExportBusy(false); }
  };
  const catalogItems = CATALOG.filter(item => (search.trim() ? item.name.toLowerCase().includes(search.trim().toLowerCase()) : item.category === category));
  const activeToolName = tool === "fixture" ? CATALOG_MAP.get(catalogId)?.name ?? "Object" : TOOLS.find(t => t.id === tool)?.name ?? SYSTEMS.find(s => s.id === tool)?.name ?? tool;
  const loadClientPlan = (saved: { plan: Plan; summary: SavedClientPlan }) => {
    if (saved.summary.stage === "archive") {
      doc.importPlan({ ...saved.plan, name: `${saved.plan.name.slice(0, 141)} (previous copy)` });
      routeToPlan(); closeModal();
      success("Opened a local copy of this previous plan. The original stays with the client."); return;
    }
    const cached = plan.id === saved.plan.id ? plan : doc.projects.find(p => p.id === saved.plan.id);
    const oldLink = cached && Object.hasOwn(cloud.links, cached.id) ? cloud.links[cached.id] : undefined;
    const keepCopy = !!cached && planFingerprint(cached) !== planFingerprint(saved.plan) && (!oldLink || oldLink.fingerprint !== planFingerprint(cached));
    doc.openSaved(saved.plan, keepCopy); cloud.attach(saved.summary, saved.plan); closeModal(); routeToPlan(saved.summary.id);
    if (keepCopy) success("Opened the client plan. Your unsaved edits are kept as a local copy in My plans.");
  };
  const openClientPlan = async (savedId: string) => {
    if (!clientPlans) return;
    if (cloud.busy || loadingPlan) { error("Wait for the current client save to finish before opening another version."); return; }
    setLoadingPlan(true);
    try { loadClientPlan(await clientPlans.get(savedId)); }
    catch (e) { error(clientPlanError(e)); }
    finally { setLoadingPlan(false); }
  };
  const startClientStage = async (clientId: string, stage: PlanStage) => {
    if (cloud.busy || loadingPlan) return;
    setLoadingPlan(true);
    try {
      doc.flush();
      let beforeRevision: number | undefined;
      if (cloud.link && cloud.dirty) {
        const saved = await cloud.save(plan, cloud.link.clientId);
        if (saved.clientId === clientId && saved.stage === "before") beforeRevision = saved.revision;
      } else if (cloud.link?.clientId === clientId && cloud.link.stage === "before") beforeRevision = cloud.link.revision;
      const saved = await cloud.start(clientId, stage, stage === "after" ? beforeRevision : undefined);
      loadClientPlan(saved);
      if (stage === "after") success("After plan opened. Edit the proposed changes; the Before plan is saved separately.");
    } catch (e) { error(clientPlanError(e)); }
    finally { setLoadingPlan(false); }
  };
  const switchClientStage = async (stage: PlanStage) => {
    if (!cloud.link || cloud.link.stage === stage) return;
    await startClientStage(cloud.link.clientId, stage);
  };
  useEffect(() => {
    if (!doc.ready || !cloud.loaded || !clientPlans) return;
    const route = `${initialPlanId ?? ""}:${initialClientId ?? ""}:${initialStage ?? ""}:${startNew}`;
    if (routeOpened.current === route) return;
    routeOpened.current = route;
    if (initialPlanId) void openClientPlan(initialPlanId);
    else if (initialClientId && (initialStage || startNew)) void startClientStage(initialClientId, initialStage ?? "before");
  }, [doc.ready, cloud.loaded, clientPlans, initialPlanId, initialClientId, initialStage, startNew]);
  const clientPair = clientPlans?.plans?.filter(p => p.clientId === cloud.link?.clientId && p.stage !== "archive");
  const beforePlan = clientPair?.find(p => p.stage === "before");
  const afterPlan = clientPair?.find(p => p.stage === "after");
  const saveLabel = cloud.busy ? "Saving to client…" : cloud.error ? "Client save failed" : cloud.link ? cloud.dirty ? "Changes pending" : "Saved to client" : doc.saveStatus === "saved" ? "Local draft saved" : doc.saveStatus === "error" ? "Backup needed" : "Saving draft…";
  const goHome = () => { if (onExit) onExit(); else window.location.assign("/dashboard"); };
  const confirmExit = async () => {
    if (exiting || cloud.busy || loadingPlan) return;
    const attempt = ++exitAttempt.current;
    setExiting(true); setExitError("");
    const draftSaved = doc.flush(); setExitDraftSaved(draftSaved);
    try {
      if (cloud.link && cloud.dirty) await cloud.save(plan, cloud.link.clientId);
      if (!draftSaved && !cloud.link) throw new Error("This draft could not be saved on this device. Stay in the editor to export a backup, or exit without saving.");
      if (attempt === exitAttempt.current) goHome();
    } catch (e) { if (attempt === exitAttempt.current) setExitError(clientPlanError(e)); }
    finally { if (attempt === exitAttempt.current) setExiting(false); }
  };
  if (!doc.ready) return <div className="fp-loading">Opening plan studio…</div>;
  return <section className="fp-studio" aria-label="Floor plan editor">
    <div className="fp-toolbar">
      <button className="fp-icon-button fp-mobile-toggle" aria-label="Toggle tools panel" aria-expanded={leftOpen} onClick={() => { setLeftOpen(!leftOpen); setRightOpen(false); }}><Menu size={18} /></button>
      <div className="fp-tools" role="toolbar" aria-label="Drawing tools"><button className="fp-icon-button fp-home-button" aria-label="Home" title="Exit to home" onClick={() => { setExitError(""); setExitDraftSaved(false); setModal("exit"); }}><House size={18} /></button>{TOOLS.map(({ id, name, icon: Icon, shortcut }, i) => <span key={id} className={i === 2 || i === 5 ? "fp-tool-start" : ""}><button aria-label={name} title={`${name} (${shortcut})`} aria-pressed={tool === id} className={`fp-tool ${tool === id ? "is-active" : ""}`} onClick={() => { chooseTool(id); if (i >= 2) setTab("build"); }}><Icon size={17} /><span>{i === 2 ? "Exterior" : i === 3 ? "Interior" : name}</span></button></span>)}</div>
      <div className="fp-toolbar-right">
        <div className="fp-plan-actions" role="group" aria-label="Plan actions">
          {clientPlans ? <button className="fp-button fp-primary" aria-label="Save plan" title="Save plan" disabled={cloud.busy || loadingPlan} onClick={() => { if (cloud.link) void cloud.save(plan, cloud.link.clientId).catch(e => error(clientPlanError(e))); else setModal("save-client"); }}><Save size={15} /><span>Save plan</span></button> : null}
          <button className="fp-button" aria-label="My plans" title="My plans" onClick={() => setModal("projects")}><FolderOpen size={15} /><span>My plans</span></button>
          <button className="fp-button" aria-label="New plan" title="New plan" onClick={() => { setNewName("New floor plan"); setModal("new"); }}><Plus size={15} /><span>New plan</span></button>
          <button className="fp-button fp-export-button" aria-label="Export" title="Export" onClick={() => setModal("export")}><Download size={15} /><span>Export</span><ChevronDown size={12} /></button>
        </div>
        <button className="fp-icon-button" aria-label="Import plan backup" title="Import a JSON backup" onClick={() => fileRef.current?.click()}><Upload size={17} /></button>
        <button className="fp-icon-button" aria-label="Keyboard shortcuts and help" title="Keyboard shortcuts and help" onClick={() => setModal("help")}><CircleHelp size={17} /></button>
        <button className="fp-icon-button fp-inspector-toggle" aria-label="Toggle properties panel" aria-expanded={rightOpen} onClick={() => { setRightOpen(!rightOpen); setLeftOpen(false); }}><PanelRight size={17} /></button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept=".json,.sah-plan.json,application/json" hidden onChange={e => void importFile(e.target.files?.[0])} />
    <div className="fp-workspace">
      {leftOpen || rightOpen ? <button className="fp-panel-backdrop" aria-label="Close side panels" onClick={() => { setLeftOpen(false); setRightOpen(false); }} /> : null}
      <aside className={`fp-left-panel ${leftOpen ? "is-open" : ""}`} aria-label="Tools and catalog">
        <nav className="fp-panel-tabs" aria-label="Editor panels">{([{ id: "build", label: "Build", icon: House }, { id: "objects", label: "Objects", icon: BedDouble }, { id: "systems", label: "Systems", icon: CircuitBoard }, { id: "layers", label: "Layers", icon: Layers3 }] as const).map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span></button>)}</nav>
        <div className="fp-panel-content">
          {tab === "build" ? <>
            <div className="fp-panel-heading"><span className="fp-kicker">01 / Architecture</span><h2>Build floor plan</h2><p>Draw the footprint. Shape the rooms.</p></div>
            <div className="fp-tool-list">{TOOLS.slice(2).map(({ id, name, icon: Icon, shortcut }) => <button key={id} className={tool === id ? "is-active" : ""} onClick={() => { chooseTool(id); setLeftOpen(false); }}><Icon size={18} /><span>{name}</span><kbd>{shortcut}</kbd></button>)}</div>
            <div className="fp-divider" /><span className="fp-kicker">Drawing defaults</span>
            <div className="fp-property-grid"><NumberField label="Exterior thickness" value={settings.exteriorThickness} min={1} max={24} step={0.5} onChange={n => setSettings(s => ({ ...s, exteriorThickness: n }))} /><NumberField label="Interior thickness" value={settings.interiorThickness} min={1} max={24} step={0.5} onChange={n => setSettings(s => ({ ...s, interiorThickness: n }))} /><NumberField label="Door width" value={settings.doorWidth} min={6} max={240} onChange={n => setSettings(s => ({ ...s, doorWidth: n }))} /><NumberField label="Window width" value={settings.windowWidth} min={6} max={240} onChange={n => setSettings(s => ({ ...s, windowWidth: n }))} /></div>
            <NumberField label="Exact next wall length" value={settings.length} min={0} max={12000} onChange={n => setSettings(s => ({ ...s, length: n }))} /><p className="fp-field-note">Enter inches for a precise wall length. Use 0 to draw freely.</p>
            <div className="fp-tip-card"><LayoutTemplate size={19} /><div><strong>Let the plan do the measuring.</strong><p>Close the exterior to generate a roof. Choose Gable or Hip in Layers. Connect partitions to create rooms and clear dimensions.</p></div></div>
          </> : null}
          {tab === "objects" ? <>
            <div className="fp-panel-heading"><span className="fp-kicker">02 / Object library</span><h2>Make it a home.</h2><p>{CATALOG.length} scaled furniture &amp; fixture symbols.</p></div>
            <label className="fp-search"><Search size={15} /><input aria-label="Search objects" placeholder="Find furniture or fixtures…" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <div className="fp-category-tabs">{CATEGORIES.map(c => <button key={c} className={category === c && !search ? "is-active" : ""} onClick={() => { setCategory(c); setSearch(""); }}>{c}</button>)}</div>
            <div className="fp-catalog-grid">{catalogItems.map(item => <button key={item.id} className={`fp-catalog-item ${tool === "fixture" && catalogId === item.id ? "is-active" : ""}`} aria-label={`Place ${item.name}`} onClick={() => pickCatalogItem(item.id)}><span className="fp-catalog-symbol"><svg viewBox="-8 -8 116 116" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><FixtureSymbol symbol={item.symbol} dark /></svg><span className="fp-catalog-plus"><Plus size={12} /></span></span><strong>{item.name}</strong><small>{item.width}″ × {item.depth}″</small></button>)}</div>
            {!catalogItems.length ? <p className="fp-field-note">No matching objects. Try “bed,” “sink,” or “outlet.”</p> : null}
            <p className="fp-field-note">Choose an object, then click to place it. Press R to rotate before placing. Switch to Select to move or resize it.</p>
          </> : null}
          {tab === "systems" ? <>
            <div className="fp-panel-heading"><span className="fp-kicker">03 / Utilities</span><h2>Connect the essentials.</h2><p>Route services and place symbols.</p></div>
            <span className="fp-field-label">Draw a utility run</span><div className="fp-tool-list">{SYSTEMS.map(s => <button key={s.id} className={tool === s.id ? "is-active" : ""} onClick={() => { chooseTool(s.id); setLayers(l => ({ ...l, utilities: true })); setLeftOpen(false); }}><span className="fp-system-line" style={{ color: s.color }} /><span>{s.name}</span><ChevronRight size={14} /></button>)}</div>
            <div className="fp-divider" /><span className="fp-field-label">Place a service symbol</span><div className="fp-service-links"><button onClick={() => { setTab("objects"); setCategory("Electrical"); setSearch(""); }}><Zap size={19} /><span>Electrical<small>Outlets, lights &amp; switches</small></span><ChevronRight size={14} /></button><button onClick={() => { setTab("objects"); setCategory("Plumbing"); setSearch(""); }}><Droplets size={19} /><span>Plumbing<small>Water heater, drains &amp; laundry</small></span><ChevronRight size={14} /></button><button onClick={() => { setTab("objects"); setCategory("Bathroom"); setSearch(""); }}><Bath size={19} /><span>Bathroom<small>Tubs, toilets &amp; showers</small></span><ChevronRight size={14} /></button></div><p className="fp-field-note">Runs are 2D annotations. Place points to route a system; press Esc to finish.</p>
          </> : null}
          {tab === "layers" ? <>
            <div className="fp-panel-heading"><span className="fp-kicker">04 / Drawing visibility</span><h2>Find your focus.</h2><p>Choose what appears on the plan and exports.</p></div>
            <div className="fp-layer-list">{(Object.keys(layers) as (keyof Layers)[]).map(key => <button key={key} role="switch" aria-label={LAYER_NAMES[key]} aria-checked={layers[key]} onClick={() => setLayers(l => ({ ...l, [key]: !l[key] }))}>{layers[key] ? <Eye size={16} /> : <EyeOff size={16} />}<span>{LAYER_NAMES[key]}</span><span className={`fp-switch ${layers[key] ? "is-on" : ""}`} /></button>)}</div>
            <div className="fp-divider" /><span className="fp-kicker">Roof settings</span>
            <div className="fp-roof-types" role="group" aria-label="Roof type">{(["gable", "hip"] as const).map(type => <button key={type} aria-label={`${type === "gable" ? "Gable" : "Hip"} roof`} aria-pressed={plan.roofType === type} onClick={() => { if (plan.roofType !== type) commit({ ...plan, roofType: type }); setLayers(l => ({ ...l, roof: true })); }}>
              <svg viewBox="0 0 44 28" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="2" y="2" width="40" height="24" rx="1" /><path d={type === "gable" ? "M2 14H42" : "M2 2L14 14H30L42 2M2 26L14 14M30 14L42 26"} /></svg><span>{type === "gable" ? "Gable" : "Hip"}</span>
            </button>)}</div>
            <NumberField label="Roof overhang" value={plan.roofOverhang} min={0} max={72} onChange={n => commit({ ...plan, roofOverhang: n })} /><p className="fp-field-note">Dashed amber lines show the eaves, ridges, hips, and valleys at 50% opacity. Overhang is measured from the outside wall face.</p>
            {roofs.some(roof => roof.error) ? <p className="fp-field-note" role="status">{roofs.find(roof => roof.error)?.error}</p> : null}
            <div className="fp-tip-card"><Layers3 size={19} /><div><strong>Finish a room.</strong><p>Switch to Select and click inside any enclosed room to name it and choose flooring.</p></div></div>
          </> : null}
        </div>
        <div className="fp-panel-footer"><span className="fp-kicker">Active tool</span><span><span className="fp-active-dot" />{activeToolName}</span>{tool === "fixture" ? <button aria-label="Rotate object preview" onClick={rotate}>Rotate {placementRotation}° <kbd>R</kbd></button> : null}</div>
      </aside>
      <PlanCanvas key={plan.id} plan={plan} tool={tool} settings={settings} layers={layers} selection={selection} catalogId={catalogId} placementRotation={placementRotation} commit={commit} select={select} error={error} onZoom={setZoom} dimensionEditingAllowed={modal === null && !loadingPlan} onDimensionApply={(id, inches, fixedEnd) => commit(editDimension(plan, id, inches, fixedEnd))} onTextPlaced={() => { chooseTool("select"); setRightOpen(true); setLeftOpen(false); setLayers(l => ({ ...l, notes: true })); }} />
      <aside className={`fp-right-panel ${rightOpen ? "is-open" : ""}`} aria-label="Properties and plan summary"><div className="fp-inspector-heading"><Settings2 size={15} /><span>Properties</span><button className="fp-icon-button" aria-label="Clear selection" onClick={() => setSelection(null)}><X size={14} /></button></div><div className="fp-inspector-scroll"><PropertyPanel plan={plan} selection={selection} rooms={rooms} commit={commit} remove={remove} duplicate={duplicate} rotate={rotateSelection} error={error} /></div><div className="fp-plan-summary"><div className="fp-plan-details">{cloud.link && cloud.link.stage !== "archive" ? <div className="fp-plan-workflow"><span className="fp-kicker">Client plans · Before → After</span><div role="group" aria-label="Client plan stages">{(["before", "after"] as const).map(stage => <button key={stage} aria-label={stage === "before" ? "Open Before plan" : afterPlan ? "Open After plan" : "Start After plan"} aria-pressed={cloud.link?.stage === stage} disabled={cloud.busy || loadingPlan || clientPair === undefined || (stage === "after" && !afterPlan && !(cloud.link?.stage === "before" ? plan.walls.length : beforePlan?.wallCount))} onClick={() => void switchClientStage(stage)}><strong>{STAGE_NAMES[stage]}</strong><small>{stage === "before" ? "Existing home" : afterPlan ? "Proposed changes" : "Copy from Before"}</small></button>)}</div><p>{cloud.link.stage === "before" ? "Draw the existing home, then start After from a saved copy." : "Draw the proposed changes. Before is saved separately."}</p></div> : null}<label className="fp-field"><span>Plan name</span><PlanName name={plan.name} onChange={name => commit({ ...plan, name })} /></label>{cloud.link ? <button className="fp-client-badge" aria-label="Change plan client" onClick={() => setModal("save-client")}><Cloud size={11} />{cloud.link.clientName}</button> : null}<span className={`fp-save-status ${cloud.error || (!cloud.link && doc.saveStatus === "error") ? "is-error" : ""}`} title={cloud.link ? `Saved with ${cloud.link.clientName}` : "Local draft; choose Save plan to link a client"}><span />{saveLabel}</span></div><span className="fp-kicker">Plan at a glance</span><div className="fp-area"><strong>{totalArea.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong><span>sq ft<small>usable floor area</small></span></div><div className="fp-summary-counts"><span><strong>{rooms.length}</strong> rooms</span><span><strong>{plan.walls.length}</strong> walls</span><span><strong>{plan.fixtures.length}</strong> objects</span></div><button className={`fp-roof-status ${roofs.length && !roofs.some(r => r.error) ? "is-ready" : ""}`} aria-label="Open roof settings" onClick={() => { setTab("layers"); setLeftOpen(true); setRightOpen(false); }}><House size={14} /><span>{roofs.some(r => r.error) ? "Review roof layout" : roofs.length ? `${plan.roofType === "hip" ? "Hip" : "Gable"} roof generated` : "Close exterior walls for roof"}</span>{roofs.length && !roofs.some(r => r.error) ? <Check size={13} /> : <ChevronRight size={13} />}</button></div></aside>
    </div>
    <footer className="fp-statusbar"><div><span className="fp-level-indicator" />Level 1<span className="fp-status-divider" />{rooms.length} enclosed rooms<span className="fp-status-divider" /><span className="fp-status-extent">{plan.walls.length ? `${formatLength(box.width)} × ${formatLength(box.height)}` : "Ready to draw"}</span></div><div><button className={settings.snap ? "is-active" : ""} aria-pressed={settings.snap} onClick={() => setSettings(s => ({ ...s, snap: !s.snap }))}>Snap {settings.snap ? "on" : "off"}</button><label>Grid <select aria-label="Grid spacing" value={settings.grid} onChange={e => setSettings(s => ({ ...s, grid: Number(e.target.value) }))}><option value={1}>1″</option><option value={3}>3″</option><option value={6}>6″</option><option value={12}>12″</option></select></label><button className={settings.orthogonal ? "is-active" : ""} aria-pressed={settings.orthogonal} onClick={() => setSettings(s => ({ ...s, orthogonal: !s.orthogonal }))}>Ortho {settings.orthogonal ? "on" : "off"}</button><span className="fp-status-divider" /><span className="fp-status-zoom">{Math.round(zoom * 100)}%</span></div></footer>
    {loadingPlan ? <div className="fp-loading-overlay" role="status"><Cloud size={20} />Opening client plan…</div> : null}
    {cloud.error ? <div className="fp-cloud-warning" role="alert"><span>{cloud.error}{doc.storageError ? " Device storage is also unavailable. Export a backup to keep your changes." : ""}</span>{doc.storageError ? <button onClick={() => void exportFile("json")}>Export backup</button> : null}<button disabled={cloud.busy} onClick={() => { if (cloud.link) void cloud.save(plan, cloud.link.clientId).catch(e => error(clientPlanError(e))); else setModal("save-client"); }}>Retry save</button><button onClick={() => setModal("projects")}>My plans</button></div> : null}
    {doc.storageError && !cloud.error ? <div className="fp-storage-warning" role="alert">{doc.storageError}<button onClick={() => void exportFile("json")}>Export backup</button></div> : null}
    {notice ? <div className={`fp-notice ${notice.kind === "error" ? "is-error" : ""}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "success" ? <Check size={16} /> : <CircleHelp size={16} />}<span>{notice.message}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div> : null}
    {modal === "save-client" && clientPlans ? <Dialog title="Save plan to a client" onClose={closeModal}><ClientSaveForm clients={clientPlans.clients} plans={clientPlans.plans} draftId={plan.id} initialStage={cloud.link?.stage === "after" ? "after" : "before"} linked={!!cloud.link} initialClientId={cloud.link?.clientId ?? initialClientId} busy={cloud.busy} onCancel={closeModal} onSave={async (clientId, stage) => { const saved = await cloud.save(plan, clientId, stage); closeModal(); routeToPlan(saved.id); success(`${STAGE_NAMES[saved.stage]} plan saved to ${saved.clientName}.`); }} onCreate={async (client, requestId) => { const saved = await cloud.saveNew(plan, client, requestId); closeModal(); routeToPlan(saved.id); success(`Client ${saved.clientName} created and Before plan saved.`); }} /></Dialog> : null}
    {modal === "exit" ? <Dialog title="Exit floor plan editor?" onClose={closeModal}>
      <p className="fp-field-note">Return to your dashboard? {cloud.link ? `Your latest changes will be saved to ${cloud.link.clientName}.` : "Your plan will stay in My plans on this device."}</p>
      {exitError ? <p className="fp-form-error" role="alert">{exitError}{exitDraftSaved ? " Your latest draft is saved on this device." : ""}</p> : null}
      <div className="fp-dialog-actions">
        <button className="fp-button" onClick={closeModal}>Stay in editor</button>
        {exitError ? <button className="fp-button" onClick={goHome}>{exitDraftSaved ? "Exit with local draft" : "Exit without saving"}</button> : null}
        <button className="fp-button fp-primary" disabled={exiting || cloud.busy || loadingPlan} onClick={() => void confirmExit()}><House size={15} />{exiting || cloud.busy ? "Saving…" : "Exit to home"}</button>
      </div>
    </Dialog> : null}
    {modal === "new" ? <Dialog title="New floor plan" onClose={closeModal}><form onSubmit={e => { e.preventDefault(); try { doc.create(newName, newTemplate === "sample"); routeToPlan(); closeModal(); } catch (e) { error(e instanceof Error ? e.message : "Could not create a plan."); } }}><label className="fp-field"><span>Plan name</span><input aria-label="New plan name" autoComplete="off" maxLength={160} value={newName} required onChange={e => setNewName(e.target.value)} /></label><div className="fp-template-options"><button type="button" aria-pressed={newTemplate === "blank"} className={newTemplate === "blank" ? "is-active" : ""} onClick={() => setNewTemplate("blank")}><Square size={30} /><strong>Blank canvas</strong><span>Your plan, from the first line.</span></button><button type="button" aria-pressed={newTemplate === "sample"} className={newTemplate === "sample" ? "is-active" : ""} onClick={() => setNewTemplate("sample")}><LayoutTemplate size={30} /><strong>Furnished example</strong><span>A 40′ × 30′ home to explore.</span></button></div><p className="fp-field-note">Your current plan stays in My plans. Save the new plan to an existing client or create a client when ready.</p><div className="fp-dialog-actions"><button type="button" className="fp-button" onClick={closeModal}>Cancel</button><button type="submit" className="fp-button fp-primary"><Plus size={15} />Create plan</button></div></form></Dialog> : null}
    {modal === "projects" ? <Dialog title="My plans" onClose={closeModal}><p className="fp-field-note">Client plans are shared across your workspace. Local drafts stay on this device.</p>{clientPlans ? <SavedClientPlans plans={clientPlans.plans} activeId={cloud.link?.id} loading={loadingPlan || cloud.busy} onOpen={id => void openClientPlan(id)} /> : null}<div className="fp-library-label"><FolderOpen size={15} /><span>Local drafts on this device</span></div><div className="fp-project-list fp-local-projects">{doc.projects.map(p => <div key={p.id} className={`fp-project-row ${p.id === plan.id ? "is-active" : ""}`}><button className="fp-project-open" onClick={() => { doc.load(p.id === plan.id ? plan : p); routeToPlan(cloud.links[p.id]?.id); closeModal(); }}><span className="fp-project-icon"><House size={22} /></span><span><strong>{p.name}</strong><small>{p.walls.length} walls · {p.fixtures.length} objects · {new Date(p.updatedAt).toLocaleDateString()}</small></span>{p.id === plan.id ? <Check size={16} /> : <ChevronRight size={16} />}</button><button className="fp-icon-button" aria-label={`Duplicate ${p.name}`} onClick={() => { try { doc.importPlan({ ...(p.id === plan.id ? plan : p), name: `${p.name.slice(0, 153)} (copy)` }); routeToPlan(); closeModal(); } catch (e) { error(e instanceof Error ? e.message : "Could not duplicate the plan."); } }}><Copy size={15} /></button><button className="fp-icon-button fp-danger" aria-label={`Delete ${p.name}`} onClick={() => setDeleteId(p.id)}><Trash2 size={15} /></button></div>)}</div>{deleteId ? <div className="fp-delete-confirm"><p>Remove this local draft? Any client-saved version stays with the client.</p><button className="fp-button" onClick={() => setDeleteId(null)}>Keep plan</button><button className="fp-button fp-danger" onClick={() => { doc.deleteProject(deleteId); setDeleteId(null); }}>Delete plan</button></div> : null}<div className="fp-dialog-actions"><button className="fp-button" onClick={() => { closeModal(); fileRef.current?.click(); }}><Upload size={15} />Import backup</button><button className="fp-button fp-compact-help" aria-label="Editor help" onClick={() => setModal("help")}><CircleHelp size={15} />Help</button><button className="fp-button fp-primary" onClick={() => { setNewName("New floor plan"); setModal("new"); }}><Plus size={15} />New plan</button></div></Dialog> : null}
    {modal === "export" ? <Dialog title="Take your plan with you." onClose={closeModal}><div className="fp-export-card"><div className="fp-export-card-heading"><Download size={22} /><div><h3>Scaled floor-plan PDF</h3><p>Black-and-white artwork, ready for printing.</p></div></div><label className="fp-field"><span>Drawing scale</span><select aria-label="PDF drawing scale" value={pdfScale} onChange={e => setPdfScale(e.target.value === "fit-a4" ? "fit-a4" : Number(e.target.value) as PdfScale)}><option value="fit-a4">Fit to A4 page (automatic scale)</option><option value={0.25}>1/4″ = 1′-0″</option><option value={0.125}>1/8″ = 1′-0″</option><option value={0.0625}>1/16″ = 1′-0″</option></select></label><p className="fp-field-note" aria-live="polite">{exportLayout ? `${exportLayout.name} · ${exportLayout.orientation} · Scale ${exportLayout.scaleLabel}. ` : ""}Includes visible layers. Print at 100% / Actual size to preserve this scale.</p><button disabled={exportBusy} className="fp-button fp-primary fp-wide" onClick={() => void exportFile("pdf")}><Download size={15} />{exportBusy ? "Preparing export…" : "Download PDF"}</button></div><div className="fp-export-secondary"><button aria-label="SVG drawing" disabled={exportBusy} onClick={() => void exportFile("svg")}><PencilRuler size={21} /><strong>SVG drawing</strong><span>Editable vector artwork</span></button><button aria-label="JSON backup" disabled={exportBusy} onClick={() => void exportFile("json")}><FileJson size={21} /><strong>JSON backup</strong><span>Reopen &amp; edit every element</span></button></div></Dialog> : null}
    {modal === "help" ? <Dialog title="From first line to floor plan." onClose={closeModal}><ol className="fp-help-steps"><li><strong>Draw the footprint.</strong><span>Use Exterior wall to click corners or drag segments. Rectangle creates four walls at once. Enter an exact wall length in inches when needed.</span></li><li><strong>Divide the space.</strong><span>Draw Interior walls between existing walls. Rooms, areas, and dimensions appear automatically. Click a room to name it and choose flooring.</span></li><li><strong>Add the details.</strong><span>Place doors and windows on walls. Pick furniture or fixtures from Objects. Draw electrical and plumbing routes in Systems. Use Textbox (T) to place construction notes, then edit them in Properties.</span></li><li><strong>Refine and export.</strong><span>Select and drag objects or wall endpoints. Use Properties to enter exact sizes. Export a scaled PDF or a JSON backup.</span></li></ol><div className="fp-shortcut-grid">{TOOLS.map(t => <span key={t.id}><kbd>{t.shortcut}</kbd>{t.name}</span>)}<span><kbd>R</kbd>Rotate object</span><span><kbd>Esc</kbd>Finish / select</span><span><kbd>Del</kbd>Delete selected</span><span><kbd>Space</kbd>Hold to pan</span><span><kbd>⌘ Z</kbd>Undo / Ctrl Z</span></div><p className="fp-field-note">Scroll to zoom around the cursor. Hold Shift while drawing to allow angles. Arrow keys nudge; Shift + arrows move 1 inch. Wall measurements use centerlines. Room areas use inside faces; room width and depth are clear bounding dimensions. Roof lines show the eaves, ridges, hips, and valleys. Choose Gable or Hip in Layers.</p></Dialog> : null}
  </section>;
}
