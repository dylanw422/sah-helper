"use client";

import { Input } from "@sah-helper/ui/components/input";
import { NativeSelect } from "@sah-helper/ui/components/native-select";
import { Checkbox } from "@sah-helper/ui/components/checkbox";
import { FieldButton } from "./field-button";
import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { CopyIcon, ExternalLinkIcon, HardHatIcon, LinkIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldProjectBoard } from "./project-board";
import "./field.css";

export function OfficeFieldProject({ clientId }: { clientId: Id<"clients"> }) {
  const project = useQuery(api.field.getProject, { clientId });
  const team = useQuery(api.field.projectTeam, { clientId });
  const clientFiles = useQuery(api.clientFiles.listClientFiles, { clientId });
  const createLink = useMutation(api.field.createProjectLink);
  const revokeLink = useMutation(api.field.revokeProjectLink);
  const shareDocument = useMutation(api.field.shareDocument);
  const unshareDocument = useMutation(api.field.unshareDocument);
  const [showInvite, setShowInvite] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmAccess, setConfirmAccess] = useState<"replace" | "revoke" | null>(null);
  const [label, setLabel] = useState("Field GC");
  const run = async (work: () => Promise<unknown>, message?: string) => {
    if (busy) return; setBusy(true);
    try { await work(); if (message) toast.success(message); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update field access."); }
    finally { setBusy(false); }
  };
  const generateLink = async () => {
    const result = await createLink({ clientId, label });
    setLink(`${window.location.origin}/field/link/${result.token}`);
    setConfirmAccess(null);
    setShowInvite(true);
    toast.success("Project link created. No account is required.");
  };
  return <section className="field-work rounded-lg border border-border bg-card p-5">
    <div className="fw-row-between"><div><p className="mb-2 flex items-center gap-2 text-xs text-indigo-400"><HardHatIcon size={16} />Field operations</p><h2 className="text-lg font-semibold tracking-tight">Field GC & construction</h2></div>
      {project && <Link href={`/field/projects/${clientId}`} target="_blank" rel="noopener noreferrer" className="fw-button"><ExternalLinkIcon />Preview field view</Link>}
    </div>
    <p className="fw-note">Share this project with your Field GC to coordinate every trade, upload photos, and submit stages. Anyone with the link can use the field dashboard without an account. Financial information stays in the office.</p>
    <div className="fw-actions"><FieldButton className="fw-button" disabled={busy} onClick={() => setShowInvite(!showInvite)}><LinkIcon />Manage project link</FieldButton>
    </div>
    {showInvite && <form className="fw-form" onSubmit={event => {
      event.preventDefault();
      if (team?.link) setConfirmAccess("replace"); else void run(generateLink);
    }}><label>Field GC or company name<Input className="fw-input" value={label} onChange={event => setLabel(event.target.value)} placeholder="Example: Johnson Construction" maxLength={120} required /></label>
      <p className="fw-note">One link opens this project only. It stays active until you revoke or replace it. Activity is attributed to this company’s project link; individual users are not verified.</p>
      <FieldButton className="fw-button" disabled={busy || team === undefined}><LinkIcon />{team?.link ? "Replace project link" : "Create project link"}</FieldButton>
      {link && <div className="fw-form-row"><Input className="fw-input" aria-label="Field GC project link" value={link} readOnly onFocus={event => event.target.select()} /><FieldButton type="button" className="fw-button" onClick={() => { void navigator.clipboard.writeText(link).then(() => toast.success("Project link copied.")).catch(() => toast.error("Select and copy the link above.")); }}><CopyIcon />Copy link</FieldButton><a className="fw-button" href={link} target="_blank" rel="noreferrer"><ExternalLinkIcon />Open dashboard</a></div>}
      {team?.link && !link && <p className="fw-note">Replace the link to get a new shareable copy. The previous link will stop working.</p>}
    </form>}
    {team?.link && <div className="fw-document"><span><strong>{team.link.label}</strong><small className="block text-muted-foreground">Link active · Created {new Date(team.link.createdAt).toLocaleDateString()}</small></span><FieldButton variant="destructive" className="fw-button" disabled={busy} onClick={() => setConfirmAccess("revoke")}>Revoke access</FieldButton></div>}
    {project && <>
      <div className="fw-section"><div className="fw-row-between"><h3 className="fw-section-title">Documents shared with the field</h3><FieldButton className="fw-button" disabled={busy} onClick={() => setSharing(!sharing)}>Share a document</FieldButton></div>
        <p className="fw-note flex gap-2"><ShieldCheckIcon size={16} className="mt-0.5 shrink-0" />Full packets and generated financial forms are not shared. Choose uploaded plans or specifications individually.</p>
        {sharing && <form className="fw-form" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void run(async () => { await shareDocument({ clientId, fileId: String(data.get("file")) as Id<"clientFiles">, confirmedNonfinancial: data.get("confirm") === "on" }); setSharing(false); }, "Document shared with the field team.");
        }}><label>Uploaded client document<NativeSelect className="fw-select" name="file" defaultValue="" required><option value="" disabled>Select a plan or specification...</option>{clientFiles?.filter(f => f.type === "uploaded").map(file => <option key={file._id} value={file._id}>{file.filename}</option>)}</NativeSelect></label>
          <label className="fw-check"><Checkbox name="confirm" required /><span>I checked that this file contains no pricing, invoices, or other financial information.</span></label>
          <FieldButton className="fw-button" disabled={busy || !clientFiles?.some(f => f.type === "uploaded")}>Share document</FieldButton>
          <p className="fw-note">PDF, JPEG, PNG or WebP · Up to 8 MB. Upload a file under Packet Files first if it is not listed here.</p>
        </form>}
        {project.files.filter(f => f.kind === "document").map(file => <div className="fw-document" key={file.id}><span>{file.filename}</span><FieldButton className="fw-button" disabled={busy} onClick={() => void run(() => unshareDocument({ id: file.id }), "Document is no longer shared.")}>Stop sharing</FieldButton></div>)}
      </div>
    </>}
    <FieldProjectBoard clientId={clientId} mode="office" />
    <ConfirmDialog open={confirmAccess !== null} title={confirmAccess === "replace" ? "Replace the project link?" : "Revoke project access?"} description="The current link will stop working for everyone who has it. Previously submitted work and photos remain in the project history."
      confirmLabel={confirmAccess === "replace" ? "Replace link" : "Revoke access"} confirming={busy} onConfirm={() => void run(async () => {
        if (confirmAccess === "replace") await generateLink();
        else if (team?.link) { await revokeLink({ id: team.link.id }); setLink(""); setConfirmAccess(null); toast.success("Project link revoked."); }
      })} onCancel={() => { if (!busy) setConfirmAccess(null); }} />
  </section>;
}
