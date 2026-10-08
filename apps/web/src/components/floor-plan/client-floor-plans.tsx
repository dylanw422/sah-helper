"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Copy, PencilRuler, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/format";
import { clientPlanError, STAGE_NAMES, type SavedClientPlan } from "@/lib/floor-plan/client-plans";

export function ClientFloorPlans({ clientId }: { clientId: Id<"clients"> }) {
  const plans = useQuery(api.floorPlans.list, { clientId }), remove = useMutation(api.floorPlans.remove);
  return <ClientFloorPlansView clientId={clientId} plans={plans} remove={id => remove({ id: id as Id<"floorPlans"> })} />;
}

export function ClientFloorPlansView({ clientId, plans, remove }: { clientId: string; plans: SavedClientPlan[] | undefined; remove: (id: string) => Promise<unknown> }) {
  const [deleteId, setDeleteId] = useState<string | null>(null), [deleting, setDeleting] = useState(false);
  const before = plans?.find(p => p.stage === "before"), after = plans?.find(p => p.stage === "after");
  const previous = plans?.filter(p => p.stage === "archive");
  return <>
    <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><PencilRuler className="size-4 text-indigo-400" />Floor Plans</CardTitle><span className="text-xs text-muted-foreground">Before → After</span></CardHeader>
      <CardContent>{plans === undefined ? <p className="text-xs text-muted-foreground">Loading floor plans…</p> : <>
        <div className="grid gap-3 md:grid-cols-2">{(["before", "after"] as const).map(stage => {
          const plan = stage === "before" ? before : after, ready = stage === "before" || !!before?.wallCount;
          const href = plan ? `/floor-plans?planId=${plan.id}` as const : `/floor-plans?clientId=${clientId}&stage=${stage}` as const;
          return <div key={stage} className="flex flex-col rounded-md border border-border bg-surface-base p-4">
            <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded bg-indigo-500/10 text-xs font-semibold text-indigo-400">{stage === "before" ? "1" : "2"}</span><h3 className="text-sm font-semibold">{STAGE_NAMES[stage]}</h3><span className="ml-auto text-[10px] text-muted-foreground">{plan ? plan.wallCount ? "Saved" : "In progress" : "Not started"}</span></div>
            <p className="mt-2 text-xs text-muted-foreground">{stage === "before" ? "Draw the home as it exists today." : "Copy Before, then draw the proposed changes."}</p>
            {plan ? <div className="my-3 min-w-0"><p className="truncate text-sm">{plan.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{plan.wallCount} walls · {plan.fixtureCount} objects · Updated {formatDate(plan.updatedAt)}</p></div> : <p className="my-3 text-[10px] text-muted-foreground">{ready ? stage === "before" ? "Start here before planning the renovation." : "Starts with all saved walls, objects, and finishes from Before." : "Draw and save Before to unlock After."}</p>}
            <div className="mt-auto flex items-center gap-2">{plan || ready ? <Link href={href} className="flex-1"><Button variant={stage === "before" || plan ? "outline" : "default"} size="sm" className="w-full">{plan ? <ArrowUpRight className="size-3.5" /> : stage === "before" ? <Plus className="size-3.5" /> : <Copy className="size-3.5" />}{plan ? `Open ${STAGE_NAMES[stage]}` : stage === "before" ? "Draw Before" : "Create After from Before"}</Button></Link> : <Button variant="outline" size="sm" disabled className="w-full">Create After from Before</Button>}
              {plan ? <Button variant="ghost" size="icon-sm" aria-label={`Delete ${STAGE_NAMES[stage]} plan`} disabled={stage === "before" && !!after} title={stage === "before" && after ? "Delete After first to keep the pair together" : undefined} onClick={() => setDeleteId(plan.id)}><Trash2 className="size-3.5 text-muted-foreground" /></Button> : null}
            </div>
          </div>;
        })}</div>
        {previous?.length ? <details className="mt-4 text-xs"><summary className="cursor-pointer text-muted-foreground">Previous plans ({previous.length})</summary><p className="mt-2 text-[10px] text-muted-foreground">Existing drawings are kept here. Opening one creates a local copy.</p><div className="mt-2 space-y-2">{previous.map(plan => <Link key={plan.id} href={`/floor-plans?planId=${plan.id}`} className="flex items-center justify-between rounded border border-border px-3 py-2"><span className="truncate">{plan.name}</span><ArrowUpRight className="size-3 shrink-0" /></Link>)}</div></details> : null}
      </>}</CardContent>
    </Card>
    <ConfirmDialog open={deleteId !== null} title="Delete this floor plan?" description="This removes the saved stage from the client. Local drafts and exported backups are kept. A new After plan can be copied from Before." confirmLabel="Delete plan" confirming={deleting} onCancel={() => setDeleteId(null)} onConfirm={async () => {
      if (!deleteId) return;
      setDeleting(true);
      try { await remove(deleteId); setDeleteId(null); toast.success("Floor plan deleted."); }
      catch (e) { toast.error(clientPlanError(e)); }
      finally { setDeleting(false); }
    }} />
  </>;
}
