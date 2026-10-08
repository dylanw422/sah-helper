"use client";

import { Save, Search, UserPlus, Users } from "lucide-react";
import { useRef, useState } from "react";
import { clientPlanError, STAGE_NAMES, type NewPlanClient, type PlanClient, type PlanStage, type SavedClientPlan } from "@/lib/floor-plan/client-plans";
import { id } from "@/lib/floor-plan/model";

export function ClientSaveForm({ clients, plans, draftId, initialClientId, initialStage = "before", linked, busy, onSave, onCreate, onCancel }: {
  clients: PlanClient[] | undefined; plans: SavedClientPlan[] | undefined; draftId: string; initialClientId?: string; initialStage?: PlanStage; linked: boolean; busy: boolean;
  onSave: (clientId: string, stage: PlanStage) => Promise<void>; onCreate: (client: NewPlanClient, requestId: string) => Promise<void>; onCancel: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(clients?.length === 0 ? "new" : "existing");
  const [clientId, setClientId] = useState(initialClientId ?? ""), [search, setSearch] = useState("");
  const [stage, setStage] = useState(initialStage);
  const [form, setForm] = useState<NewPlanClient>({ name: "", street: "", city: "", state: "", zip: "", phone: "", caseNumber: "", drawCount: 4 });
  const [error, setError] = useState("");
  const requestId = useRef(id());
  const filtered = clients?.filter(c => `${c.name} ${c.street} ${c.caseNumber}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const pair = plans?.filter(p => p.clientId === clientId), before = pair?.find(p => p.stage === "before");
  const occupied = (candidate: PlanStage) => pair?.some(p => p.stage === candidate && p.draftId !== draftId);
  const existingAfter = pair?.some(p => p.stage === "after" && p.draftId === draftId);
  const blocked = mode === "existing" && (plans === undefined || occupied(stage) || (stage === "after" && !existingAfter && !before?.wallCount));
  const update = (field: keyof NewPlanClient, value: string) => setForm(f => ({ ...f, [field]: field === "drawCount" ? Number(value) as 4 | 5 | 6 : value }));
  return <form onSubmit={async e => {
    e.preventDefault(); setError("");
    if (busy) return;
    try {
      if (mode === "existing") { if (!clientId) throw new Error("Choose a client to save this plan."); if (blocked) throw new Error("Open the client's existing plan, or choose an available stage."); await onSave(clientId, stage); }
      else await onCreate(form, requestId.current);
    } catch (e) { setError(clientPlanError(e)); }
  }}>
    <div className="fp-client-mode"><button type="button" disabled={busy} aria-pressed={mode === "existing"} className={mode === "existing" ? "is-active" : ""} onClick={() => setMode("existing")}><Users size={16} />Existing client</button><button type="button" disabled={busy || (linked && initialStage === "after")} aria-pressed={mode === "new"} className={mode === "new" ? "is-active" : ""} onClick={() => setMode("new")}><UserPlus size={16} />Create new client</button></div>
    <fieldset disabled={busy} className="fp-client-fieldset">
      {mode === "existing" ? <>
        <label className="fp-search"><Search size={15} /><input aria-label="Filter clients" placeholder="Find a client by name, address, or case…" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label className="fp-field"><span>Client</span><select aria-label="Save plan to client" value={clientId} required onChange={e => { setClientId(e.target.value); if (!linked) setStage(plans?.some(p => p.clientId === e.target.value && p.stage === "before") ? "after" : "before"); }}><option value="">{clients === undefined ? "Loading clients…" : "Choose a client"}</option>{filtered.map(c => <option key={c.id} value={c.id} disabled={linked && initialStage === "after" && c.id !== initialClientId}>{c.name}{c.street ? ` · ${c.street}` : ""}</option>)}</select></label>
        <label className="fp-field"><span>Plan stage</span><select aria-label="Plan stage" disabled={linked} value={stage} onChange={e => setStage(e.target.value as PlanStage)}><option value="before" disabled={!!occupied("before")}>Before — existing home</option><option value="after" disabled={(!existingAfter && !before?.wallCount) || !!occupied("after")}>After — proposed changes</option></select></label>
        {clientId && blocked ? <p className="fp-field-note">{occupied(stage) ? `This client already has a ${STAGE_NAMES[stage]} plan. Open it from My plans to continue editing.` : "Draw and save this client's Before plan first."}</p> : null}
        {clients?.length === 0 ? <p className="fp-field-note">No clients yet. Choose Create new client to save your first plan.</p> : null}
      </> : <>
        <p className="fp-field-note">This drawing becomes the client's Before plan. After starts as a copy of Before when you are ready to draw the proposed changes.</p>
        <label className="fp-field"><span>Client name</span><input aria-label="Client name" required maxLength={160} value={form.name} onChange={e => update("name", e.target.value)} /></label>
        <label className="fp-field"><span>Street address (optional)</span><input aria-label="Client street address" maxLength={160} value={form.street} onChange={e => update("street", e.target.value)} /></label>
        <div className="fp-property-grid">{([{ key: "city", label: "City" }, { key: "state", label: "State" }, { key: "zip", label: "ZIP code" }, { key: "phone", label: "Phone" }, { key: "caseNumber", label: "Case number" }] as const).map(({ key, label }) => <label className="fp-field" key={key}><span>{label} (optional)</span><input aria-label={`Client ${label.toLowerCase()}`} maxLength={80} value={form[key]} onChange={e => update(key, e.target.value)} /></label>)}<label className="fp-field"><span>Draw count</span><select aria-label="Client draw count" value={form.drawCount} onChange={e => update("drawCount", e.target.value)}><option value={4}>4 draws</option><option value={5}>5 draws</option><option value={6}>6 draws</option></select></label></div>
      </>}
    </fieldset>
    <p className="fp-field-note">Each client has one Before plan and one After plan. Linked changes autosave to the selected stage.</p>
    {error ? <p className="fp-form-error" role="alert">{error}</p> : null}
    <div className="fp-dialog-actions"><button type="button" className="fp-button" disabled={busy} onClick={onCancel}>Cancel</button><button className="fp-button fp-primary" type="submit" disabled={busy || blocked || (mode === "existing" && clients === undefined)}><Save size={15} />{busy ? "Saving…" : mode === "existing" ? "Save plan to client" : "Create client & save plan"}</button></div>
  </form>;
}
