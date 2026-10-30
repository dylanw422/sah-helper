"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { BellIcon, CameraIcon, CheckCheckIcon, ClipboardCheckIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export function OfficeProjectUpdates() {
  const updates = useQuery(api.field.notifications);
  const markRead = useMutation(api.field.markNotificationsRead);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [busy, setBusy] = useState(false);
  const unread = updates?.items.filter(item => !item.read) ?? [];
  const shown = (filter === "unread" ? unread : updates?.items ?? []).slice(0, 8);
  return <section className="mb-8 overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><BellIcon className="size-4 text-indigo-400" />Project updates{unread.length > 0 && <span className="rounded bg-indigo-400/10 px-1.5 py-0.5 text-[10px] text-indigo-400">{unread.length} new</span>}</h2><p className="mt-1 text-xs text-muted-foreground">Field activity, blockers, and construction review requests.</p></div>
      <div className="flex items-center gap-3 text-xs"><button aria-pressed={filter === "unread"} onClick={() => setFilter("unread")} className={filter === "unread" ? "font-semibold text-foreground" : "text-muted-foreground"}>Unread</button><button aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={filter === "all" ? "font-semibold text-foreground" : "text-muted-foreground"}>Recent</button>
        {!!unread.length && <button className="flex items-center gap-1 text-muted-foreground disabled:opacity-50" disabled={busy} onClick={async () => {
          setBusy(true); try { await markRead({ ids: unread.map(item => item.id) }); } catch { toast.error("Could not mark updates read."); } finally { setBusy(false); }
        }}><CheckCheckIcon size={14} />Mark recent read</button>}
      </div>
    </div>
    {updates === undefined ? <p role="status" className="px-5 py-5 text-xs text-muted-foreground">Loading project updates...</p> : !shown.length ? <p className="px-5 py-5 text-xs text-muted-foreground">{filter === "unread" ? "You're caught up. New field updates will appear here." : "Set up field operations on a client record to start receiving project updates."}</p> : <ul className="divide-y divide-border">
      {shown.map(item => { const Icon = item.type === "blocked" ? TriangleAlertIcon : item.type === "stage_submitted" ? ClipboardCheckIcon : item.type === "photo_added" ? CameraIcon : BellIcon;
        return <li key={item.id} className="flex items-start gap-3 px-5 py-4"><span className={`mt-0.5 rounded-md p-2 ${item.type === "blocked" ? "bg-amber-400/10 text-amber-400" : "bg-indigo-400/10 text-indigo-400"}`}><Icon size={15} /></span><div className="min-w-0 flex-1"><Link href={`/clients/${item.clientId}`} className="text-xs font-semibold hover:underline">{item.projectName}</Link><p className="mt-1 text-xs leading-relaxed text-muted-foreground"><span className="text-foreground">{item.actorName}</span> · {item.message}</p><p className="mt-1 text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></div>
          <Link href={`/clients/${item.clientId}`} className="shrink-0 text-xs font-medium text-indigo-400">{item.type === "stage_submitted" ? "Review work" : "View project"} →</Link></li>;
      })}
    </ul>}
    {(updates?.hasOlder || (filter === "unread" ? unread.length : updates?.items.length ?? 0) > 8) && <p className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground">Showing recent updates. Open a project for its activity history.</p>}
  </section>;
}
