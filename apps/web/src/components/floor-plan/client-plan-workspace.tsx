"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useWorkspaceId } from "@/components/workspace-context";
import { parsePlan } from "@/lib/floor-plan/model";
import type { ClientPlanGateway } from "@/lib/floor-plan/client-plans";
import { FloorPlanEditor } from "./floor-plan-editor";

export function ClientPlanWorkspace() {
  const workspaceId = useWorkspaceId(), params = useSearchParams(), convex = useConvex(), router = useRouter();
  const clients = useQuery(api.floorPlans.listClients, {}), plans = useQuery(api.floorPlans.list, {});
  const save = useMutation(api.floorPlans.save), saveNew = useMutation(api.floorPlans.saveToNewClient), start = useMutation(api.floorPlans.start);
  const gateway = useMemo<ClientPlanGateway>(() => ({
    clients, plans,
    save: (plan, clientId, expectedRevision, stage) => save({ clientId: clientId as Id<"clients">, document: JSON.stringify(plan), expectedRevision, stage }),
    saveToNewClient: (plan, client, expectedRevision, requestId) => saveNew({ client, document: JSON.stringify(plan), expectedRevision, requestId }),
    get: async id => { const result = await convex.query(api.floorPlans.get, { id: id as Id<"floorPlans"> }); return { plan: parsePlan(JSON.parse(result.document)), summary: result.summary }; },
    start: async (clientId, stage, expectedBeforeRevision) => { const result = await start({ clientId: clientId as Id<"clients">, stage, expectedBeforeRevision }); return { plan: parsePlan(JSON.parse(result.document)), summary: result.summary }; },
  }), [clients, plans, convex, save, saveNew, start]);
  const stage = params.get("stage");
  return <FloorPlanEditor key={workspaceId} storageKey={`sah-helper:floor-plans:v1:${workspaceId}`} clientPlans={gateway} initialClientId={params.get("clientId") ?? undefined} initialPlanId={params.get("planId") ?? undefined} initialStage={stage === "before" || stage === "after" ? stage : undefined} startNew={params.get("new") === "1"} onClientPlanCreated={id => router.replace(id ? `/floor-plans?planId=${id}` : "/floor-plans", { scroll: false })} onExit={() => router.push("/dashboard")} />;
}
