import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClientFloorPlansView } from "../../apps/web/src/components/floor-plan/client-floor-plans";
import { FloorPlanEditor } from "../../apps/web/src/components/floor-plan/floor-plan-editor";
import type { ClientPlanGateway, NewPlanClient, PlanClient, PlanStage, SavedClientPlan } from "../../apps/web/src/lib/floor-plan/client-plans";
import { blankPlan, type Plan } from "../../apps/web/src/lib/floor-plan/model";

// This service double exercises production UI and sync hooks. Real authorization,
// transactional saves, retries and workspace isolation are covered by Convex tests.
type Record = { summary: SavedClientPlan; plan: Plan; requestId?: string };
type Server = { clients: PlanClient[]; records: Record[] };
const serverKey = "sah-helper:floor-plan-test-server";
let server: Server = JSON.parse(localStorage.getItem(serverKey) ?? "null") ?? { clients: [{ id: "client-alex", name: "Alex Existing", street: "10 Main", city: "Austin", state: "TX", caseNumber: "123" }], records: [] };
declare global { interface Window { testSaveFailure?: string; testSaveDelay?: number; testRemoteEdit?: (id: string) => void; } }
function Harness() {
  const [view, setView] = useState(server);
  const [exited, setExited] = useState(false);
  const update = () => { server = { clients: [...server.clients], records: [...server.records] }; localStorage.setItem(serverKey, JSON.stringify(server)); setView(server); };
  const gateway = useMemo<ClientPlanGateway>(() => {
    const save = async (plan: Plan, clientId: string, revision: number, stage?: PlanStage, requestId?: string, newClient?: NewPlanClient) => {
      await new Promise(resolve => setTimeout(resolve, window.testSaveDelay ?? 150));
      if (window.testSaveFailure) { const message = window.testSaveFailure; window.testSaveFailure = undefined; throw new Error(message); }
      const old = server.records.find(p => p.plan.id === plan.id);
      if (old && JSON.stringify(old.plan) === JSON.stringify(plan) && (old.summary.clientId === clientId || (requestId !== undefined && old.requestId === requestId))) return old.summary;
      if ((old?.summary.revision ?? 0) !== revision) throw new Error("A newer version of this plan is saved. Open the saved version from My plans, or duplicate your draft to save a separate copy.");
      const targetStage = stage ?? old?.summary.stage ?? "before";
      if (old && old.summary.stage !== targetStage) throw new Error("A saved plan keeps its Before or After stage.");
      if (old?.summary.stage === "after" && old.summary.clientId !== clientId && !newClient) throw new Error("Keep the Before and After plans with the same client.");
      if (old && old.summary.clientId !== clientId && server.records.some(r => r.summary.clientId === old.summary.clientId && r.summary.stage === "after")) throw new Error("Keep the Before and After plans with the same client.");
      if (newClient) { clientId = crypto.randomUUID(); server.clients.push({ ...newClient, id: clientId }); }
      const client = server.clients.find(c => c.id === clientId);
      if (!client) throw new Error("Client not found.");
      const slot = server.records.find(r => r.summary.clientId === clientId && r.summary.stage === targetStage && r.plan.id !== plan.id);
      if (slot) throw new Error(`This client already has a ${targetStage} plan.`);
      if (targetStage === "after" && !server.records.some(r => r.summary.clientId === clientId && r.summary.stage === "before" && r.plan.walls.length)) throw new Error("Draw and save the Before plan first.");
      const summary = { stage: targetStage, id: old?.summary.id ?? crypto.randomUUID(), clientId, clientName: client.name, draftId: plan.id, name: plan.name, revision: revision + 1, updatedAt: Date.now(), wallCount: plan.walls.length, fixtureCount: plan.fixtures.length };
      server.records = [...server.records.filter(r => r.plan.id !== plan.id), { summary, plan: structuredClone(plan), requestId }]; update(); return summary;
    };
    return { clients: view.clients, plans: view.records.map(r => r.summary), save,
      saveToNewClient: (plan, client, revision, requestId) => save(plan, "", revision, "before", requestId, client),
      start: async (clientId, stage, expectedBeforeRevision) => {
        const existing = server.records.find(r => r.summary.clientId === clientId && r.summary.stage === stage);
        if (existing) return structuredClone({ plan: existing.plan, summary: existing.summary });
        const before = server.records.find(r => r.summary.clientId === clientId && r.summary.stage === "before");
        if (stage === "after" && !before?.plan.walls.length) throw new Error("Draw and save the Before plan first.");
        if (stage === "after" && expectedBeforeRevision !== undefined && before.summary.revision !== expectedBeforeRevision) throw new Error("A newer version of this plan is saved.");
        const client = server.clients.find(c => c.id === clientId);
        if (!client) throw new Error("Client not found.");
        const source = stage === "after" ? structuredClone(before.plan) : blankPlan(`${client.name} — Before`);
        const copy = { ...source, id: crypto.randomUUID(), name: stage === "after" ? `${source.name.replace(/\s*[—-]\s*Before$/i, "")} — After` : source.name, updatedAt: Date.now() };
        const summary = await save(copy, clientId, 0, stage);
        return { plan: copy, summary };
      },
      get: async id => { const r = server.records.find(r => r.summary.id === id); if (!r) throw new Error("Plan not found."); return structuredClone({ plan: r.plan, summary: r.summary }); },
    };
  }, [view]);
  window.testRemoteEdit = id => { const r = server.records.find(r => r.summary.id === id)!; r.plan = { ...r.plan, name: "Remote version", updatedAt: Date.now() }; r.summary = { ...r.summary, name: r.plan.name, revision: r.summary.revision + 1 }; update(); };
  const params = new URLSearchParams(location.search);
  const clientView = params.get("clientView");
  if (clientView) return <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}><h1>Client floor plans</h1><ClientFloorPlansView clientId={clientView} plans={view.records.filter(r => r.summary.clientId === clientView).map(r => r.summary)} remove={async id => { server.records = server.records.filter(r => r.summary.id !== id); update(); }} /></main>;
  return exited ? <main><h1>Dashboard</h1></main> : <FloorPlanEditor storageKey="sah-helper:floor-plan-browser-test" clientPlans={gateway} initialPlanId={params.get("planId") ?? undefined} initialClientId={params.get("clientId") ?? undefined} initialStage={params.get("stage") === "after" ? "after" : params.get("stage") === "before" ? "before" : undefined} startNew={params.get("new") === "1"} onClientPlanCreated={id => history.replaceState(null, "", id ? `?planId=${id}` : "/")} onExit={() => { history.pushState(null, "", "/dashboard"); setExited(true); }} />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
