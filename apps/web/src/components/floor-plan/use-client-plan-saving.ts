"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clientPlanError, planFingerprint, type ClientPlanGateway, type ClientPlanLink, type NewPlanClient, type SavedClientPlan, type PlanStage } from "@/lib/floor-plan/client-plans";
import type { Plan } from "@/lib/floor-plan/model";

export function useClientPlanSaving(plan: Plan, storageKey: string, gateway: ClientPlanGateway | undefined, ready: boolean, paused: boolean) {
  const [links, setLinks] = useState<Record<string, ClientPlanLink>>({});
  const linksRef = useRef(links); linksRef.current = links;
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const lookup = useCallback((draftId: string) => Object.hasOwn(linksRef.current, draftId) ? linksRef.current[draftId] : undefined, []);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`${storageKey}:client-links`) ?? "{}");
      const restored: Record<string, ClientPlanLink> = {};
      if (saved && typeof saved === "object") for (const [key, value] of Object.entries(saved)) {
        if (value && typeof value === "object" && typeof value.id === "string" && typeof value.clientId === "string" && typeof value.clientName === "string" && typeof value.fingerprint === "string" && Number.isInteger(value.revision) && value.revision > 0) restored[key] = value as ClientPlanLink;
      }
      linksRef.current = restored; setLinks(restored);
    } catch { /* A local draft can still be explicitly saved or a server plan reopened. */ }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (!gateway?.plans || !loaded) return;
    let changed = false;
    const next = { ...linksRef.current };
    for (const [draftId, link] of Object.entries(next)) {
      const saved = gateway.plans.find(p => p.id === link.id);
      if (saved && (saved.stage !== link.stage || saved.clientName !== link.clientName)) {
        next[draftId] = { ...link, stage: saved.stage, clientName: saved.clientName }; changed = true;
      }
    }
    if (changed) {
      linksRef.current = next; setLinks(next);
      try { localStorage.setItem(`${storageKey}:client-links`, JSON.stringify(next)); } catch { /* Documents have their own recovery state. */ }
    }
  }, [gateway?.plans, loaded, storageKey]);
  const attach = useCallback((summary: SavedClientPlan, snapshot: Plan) => {
    const link = { ...summary, fingerprint: planFingerprint(snapshot) };
    const next = { ...linksRef.current, [snapshot.id]: link };
    linksRef.current = next; setLinks(next);
    try { localStorage.setItem(`${storageKey}:client-links`, JSON.stringify(next)); } catch { /* The document cache reports storage failure; the client plan is safely saved. */ }
    setErrors(prev => ({ ...prev, [snapshot.id]: "" }));
    return link;
  }, [storageKey]);
  const save = useCallback(async (snapshot: Plan, clientId: string, stage?: PlanStage) => {
    if (!gateway) throw new Error("Client saving is unavailable.");
    if (pending.current.size) throw new Error("Please wait for the current save to finish.");
    pending.current.add(snapshot.id); setBusy(true); setErrors(prev => ({ ...prev, [snapshot.id]: "" }));
    try {
      const linkedStage = gateway.plans?.find(p => p.id === lookup(snapshot.id)?.id)?.stage ?? lookup(snapshot.id)?.stage;
      const result = await gateway.save(snapshot, clientId, lookup(snapshot.id)?.revision ?? 0, stage ?? (linkedStage === "after" ? "after" : linkedStage === "before" ? "before" : undefined));
      attach(result, snapshot); return result;
    } catch (error) { setErrors(prev => ({ ...prev, [snapshot.id]: clientPlanError(error) })); throw error; }
    finally { pending.current.delete(snapshot.id); setBusy(false); }
  }, [gateway, attach, lookup]);
  const start = useCallback(async (clientId: string, stage: PlanStage, expectedBeforeRevision?: number) => {
    if (!gateway) throw new Error("Client saving is unavailable.");
    if (pending.current.size) throw new Error("Please wait for the current save to finish.");
    const key = `start:${clientId}:${stage}`;
    pending.current.add(key); setBusy(true);
    try {
      const result = await gateway.start(clientId, stage, expectedBeforeRevision);
      attach(result.summary, result.plan); return result;
    } finally { pending.current.delete(key); setBusy(false); }
  }, [gateway, attach]);
  const saveNew = useCallback(async (snapshot: Plan, client: NewPlanClient, requestId: string) => {
    if (!gateway) throw new Error("Client saving is unavailable.");
    if (pending.current.size) throw new Error("Please wait for the current save to finish.");
    pending.current.add(snapshot.id); setBusy(true); setErrors(prev => ({ ...prev, [snapshot.id]: "" }));
    try {
      const result = await gateway.saveToNewClient(snapshot, client, lookup(snapshot.id)?.revision ?? 0, requestId);
      attach(result, snapshot); return result;
    } catch (error) { setErrors(prev => ({ ...prev, [snapshot.id]: clientPlanError(error) })); throw error; }
    finally { pending.current.delete(snapshot.id); setBusy(false); }
  }, [gateway, attach, lookup]);
  const fingerprint = useMemo(() => planFingerprint(plan), [plan]);
  const link = Object.hasOwn(links, plan.id) ? links[plan.id] : undefined;
  const dirty = !!link && link.fingerprint !== fingerprint;
  const error = Object.hasOwn(errors, plan.id) ? errors[plan.id] : "";
  useEffect(() => {
    if (!gateway || !ready || !loaded || !link || !dirty || busy || paused || error) return;
    const timer = window.setTimeout(() => { void save(plan, link.clientId).catch(() => {}); }, 1000);
    return () => window.clearTimeout(timer);
  }, [gateway, ready, loaded, link, dirty, busy, paused, error, plan, save]);
  return { link, links, busy, dirty, error, loaded, save, saveNew, attach, start };
}
