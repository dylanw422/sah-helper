"use client";

import { Check, ChevronRight, Cloud, House } from "lucide-react";
import { useState } from "react";
import { STAGE_NAMES, type SavedClientPlan } from "@/lib/floor-plan/client-plans";

export function SavedClientPlans({ plans, activeId, loading, onOpen }: { plans: SavedClientPlan[] | undefined; activeId?: string; loading: boolean; onOpen: (id: string) => void }) {
  const [clientId, setClientId] = useState("");
  const clients = [...new Map(plans?.map(p => [p.clientId, p.clientName]) ?? []).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const order = { before: 0, after: 1, archive: 2 };
  const filtered = plans?.filter(p => !clientId || p.clientId === clientId).sort((a, b) => a.clientName.localeCompare(b.clientName) || order[a.stage] - order[b.stage]);
  return <div className="fp-saved-client-plans"><div className="fp-library-label"><Cloud size={15} /><span>Saved to clients</span></div>
    {clients.length > 1 ? <label className="fp-field"><span>Filter by client</span><select aria-label="Filter saved plans by client" value={clientId} onChange={e => setClientId(e.target.value)}><option value="">All clients</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
    {plans === undefined ? <p className="fp-field-note">Loading client plans…</p> : !filtered?.length ? <p className="fp-field-note">No client plans yet. Use Save plan to choose or create a client.</p> : <div className="fp-project-list">{filtered.map(p => <div key={p.id} className={`fp-project-row ${p.id === activeId ? "is-active" : ""}`}><button className="fp-project-open" aria-label={`Open ${p.name} for ${p.clientName}`} disabled={loading} onClick={() => onOpen(p.id)}><span className="fp-project-icon"><House size={22} /></span><span><strong>{STAGE_NAMES[p.stage]} · {p.name}</strong><small>{p.clientName} · {p.wallCount} walls · {new Date(p.updatedAt).toLocaleDateString()}</small></span>{p.id === activeId ? <Check size={16} /> : <ChevronRight size={16} />}</button></div>)}</div>}
  </div>;
}
