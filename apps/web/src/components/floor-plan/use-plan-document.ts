"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { detectRooms } from "@/lib/floor-plan/geometry";
import { blankPlan, id, parsePlan, starterPlan, type Plan } from "@/lib/floor-plan/model";

type History = { plan: Plan; past: Plan[]; future: Plan[] };
type Action = { type: "commit" | "load"; plan: Plan } | { type: "undo" | "redo" };
function reducer(state: History, action: Action): History {
  if (action.type === "load") return { plan: action.plan, past: [], future: [] };
  if (action.type === "commit") {
    if (JSON.stringify({ ...action.plan, updatedAt: state.plan.updatedAt }) === JSON.stringify(state.plan)) return state;
    return { plan: { ...action.plan, updatedAt: Date.now() }, past: [...state.past.slice(-79), state.plan], future: [] };
  }
  if (action.type === "undo" && state.past.length) return { plan: { ...state.past[state.past.length - 1], updatedAt: Date.now() }, past: state.past.slice(0, -1), future: [state.plan, ...state.future] };
  if (action.type === "redo" && state.future.length) return { plan: { ...state.future[0], updatedAt: Date.now() }, past: [...state.past, state.plan], future: state.future.slice(1) };
  return state;
}
export function furnishedPlan() {
  const plan = starterPlan();
  for (const room of detectRooms(plan.walls)) {
    plan.rooms[room.id] = room.center.x < 288 ? { name: "LIVING / KITCHEN", finish: "wood" } : room.center.y < 216 ? { name: "BEDROOM", finish: "carpet" } : room.center.x < 408 ? { name: "BATHROOM", finish: "tile" } : { name: "UTILITY", finish: "tile" };
  }
  return plan;
}
export function usePlanDocument(storageKey: string) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ plan: blankPlan(), past: [], future: [] }));
  const [projects, setProjects] = useState<Plan[]>([]);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [storageError, setStorageError] = useState("");
  const library = useRef<Plan[]>([]), current = useRef(state.plan);
  current.current = state.plan;
  const persist = useCallback((plan: Plan) => {
    const plans = [plan, ...library.current.filter(p => p.id !== plan.id)];
    library.current = plans; setProjects(plans);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, activeId: plan.id, plans }));
      setSaveStatus("saved"); setStorageError("");
      return true;
    } catch {
      setSaveStatus("error"); setStorageError("Device storage is unavailable or full. Export a backup to keep your work.");
      return false;
    }
  }, [storageKey]);
  const flush = useCallback(() => persist(current.current), [persist]);
  useEffect(() => {
    let plans: Plan[] = [];
    let activeId = "";
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw);
        if (!Array.isArray(stored.plans) || stored.plans.length > 50) throw new Error("Invalid library");
        plans = stored.plans.map(parsePlan); activeId = stored.activeId;
      }
    } catch { setStorageError("Saved plans could not be read. Your previous data has been kept under a recovery key.");
      try { const raw = localStorage.getItem(storageKey); if (raw) localStorage.setItem(`${storageKey}:recovery:${Date.now()}`, raw); } catch { /* The save indicator will report storage failure. */ }
    }
    const plan = plans.find(p => p.id === activeId) ?? plans[0] ?? furnishedPlan();
    library.current = plans.length ? plans : [plan];
    setProjects(library.current); dispatch({ type: "load", plan }); setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => persist(state.plan), 400);
    return () => window.clearTimeout(timer);
  }, [ready, state.plan, persist]);
  useEffect(() => {
    if (!ready) return;
    const flush = () => persist(current.current);
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility); flush(); };
  }, [ready, persist]);
  const load = useCallback((plan: Plan) => {
    if (library.current.length >= 50 && !library.current.some(p => p.id === plan.id)) throw new Error("The library holds up to 50 plans. Export and delete a plan to make room.");
    persist(current.current); dispatch({ type: "load", plan });
  }, [persist]);
  const create = useCallback((name: string, furnished: boolean) => { const plan = furnished ? furnishedPlan() : blankPlan(); plan.name = name.trim() || "Untitled floor plan"; load(plan); return plan; }, [load]);
  const importPlan = useCallback((plan: Plan) => { load({ ...plan, id: id(), updatedAt: Date.now() }); }, [load]);
  const deleteProject = useCallback((projectId: string) => {
    library.current = library.current.filter(p => p.id !== projectId);
    const next = current.current.id === projectId ? library.current[0] ?? blankPlan() : current.current;
    persist(next); dispatch({ type: "load", plan: next });
  }, [persist]);
  const commit = useCallback((plan: Plan) => dispatch({ type: "commit", plan }), []);
  const openSaved = useCallback((saved: Plan, keepLocalCopy: boolean) => {
    if (keepLocalCopy) {
      const old = current.current.id === saved.id ? current.current : library.current.find(p => p.id === saved.id);
      if (old) {
        if (library.current.length >= 50) throw new Error("Export and remove a local draft before making a recovery copy.");
        library.current = [{ ...old, id: id(), name: `${old.name.slice(0, 143)} (local copy)`, updatedAt: Date.now() }, ...library.current];
      }
    }
    load(saved);
  }, [load]);
  return { ...state, ready, projects, saveStatus, storageError, commit, load, openSaved, create, importPlan, deleteProject, flush, undo: () => dispatch({ type: "undo" }), redo: () => dispatch({ type: "redo" }) };
}
