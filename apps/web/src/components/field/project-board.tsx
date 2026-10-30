"use client";

import { Input } from "@sah-helper/ui/components/input";
import { Textarea } from "@sah-helper/ui/components/textarea";
import { Checkbox } from "@sah-helper/ui/components/checkbox";
import { FieldButton } from "./field-button";
import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { CameraIcon, CheckIcon, ChevronDownIcon, FileTextIcon, PlusIcon, SendIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FieldFileViewer } from "./file-viewer";
import { prepareProgressPhoto } from "./prepare-photo";
import "./field.css";

type Project = FunctionReturnType<typeof api.field.getProject>;
type Stage = Project["stages"][number];
const STATUS_LABELS: Record<Stage["status"], string> = {
  not_started: "Not started", in_progress: "In progress", submitted: "Awaiting review", verified: "Verified", changes_requested: "Changes requested",
};
export function FieldProjectBoard({ clientId, mode, token }: { clientId: Id<"clients">; mode: "office" | "field"; token?: string }) {
  const project = useQuery(api.field.getProject, { clientId, token });
  const sync = useMutation(api.field.syncProjectSchedule);
  const [syncError, setSyncError] = useState("");
  const [syncAttempt, setSyncAttempt] = useState(0);
  const needsSync = project?.needsScheduleSync && !project?.scheduleError;
  useEffect(() => {
    if (!needsSync) return;
    let disposed = false;
    setSyncError("");
    void sync({ clientId, token }).catch(error => { if (!disposed) setSyncError(error instanceof Error ? error.message : "Could not sync the draw schedule. Please try again."); });
    return () => { disposed = true; };
  }, [needsSync, clientId, token, sync, syncAttempt]);
  const [viewFile, setViewFile] = useState<Id<"projectFiles"> | null>(null);
  if (!project) return <div role="status" className="fw-note">Loading project progress...</div>;
  if (project.scheduleError) return <p className="fw-alert" role="alert">{project.scheduleError}</p>;
  if (project.needsScheduleSync) return syncError ? <div className="fw-alert" role="alert">{syncError}<div className="fw-actions"><FieldButton className="fw-button" onClick={() => setSyncAttempt(value => value + 1)}>Retry schedule sync</FieldButton></div></div> : <p className="fw-note" role="status">Loading work from the draw schedule…</p>;
  const activeStages = project.stages.filter(stage => !stage.archived);
  const office = mode === "office" && project.office;
  const preview = mode === "field" && project.office;
  return <div className="field-work">
    {preview && <p className="fw-alert">Field GC preview · This view is read-only. It shows only the information shared with your field team.</p>}
    {mode === "field" && !!activeStages.length && <div className="fw-overview" aria-label="Project progress">
      <div><strong>{activeStages.filter(s => s.status === "verified").length}/{activeStages.length}</strong><span>Stages verified</span></div>
      <div><strong>{activeStages.filter(s => s.status === "submitted").length}</strong><span>With the office</span></div>
      <div><strong>{activeStages.filter(s => !!s.blocker).length}</strong><span>Open issues</span></div>
    </div>}
    <div className="fw-section">
      <h2 className="fw-section-title">Completion stages</h2>
      <p className="fw-note">Work items follow the draw schedule, with office-only items excluded. The office tracks inspections and paperwork separately.</p>
      {activeStages.map((stage, index) => <StageCard key={stage.id} stage={stage} index={index} active={index === activeStages.findIndex(s => s.status !== "verified")} office={office} preview={preview} finalReady={activeStages.filter(s => !s.final).every(s => s.status === "verified")} token={token} files={project.files.filter(f => f.stageId === stage.id)} onView={setViewFile} />)}
    </div>
    {project.stages.some(stage => stage.archived) && <div className="fw-section"><h2 className="fw-section-title">Previous stages & evidence</h2><p className="fw-note">Earlier stage records are kept for reference and are not part of the current draw schedule.</p>{project.stages.filter(stage => stage.archived).map((stage, index) => <StageCard key={stage.id} stage={stage} index={index} active={false} office={false} preview finalReady={false} token={token} files={project.files.filter(file => file.stageId === stage.id)} onView={setViewFile} />)}</div>}
    <div className="fw-section"><h2 className="fw-section-title">Plans & specifications</h2><div className="fw-card">
      {!project.files.some(f => f.kind === "document") && <p className="fw-note">No documents have been shared by the office yet.</p>}
      {project.files.filter(f => f.kind === "document").map(file => <div className="fw-document" key={file.id}><span>{file.filename}</span><FieldButton className="fw-button" onClick={() => setViewFile(file.id)}><FileTextIcon />View</FieldButton></div>)}
    </div></div>
    <div className="fw-section"><h2 className="fw-section-title">Project activity</h2><div className="fw-card">
      {!project.activity.length && <p className="fw-note">Project updates will appear here.</p>}
      {project.activity.slice(0, 12).map(event => <div className="fw-activity" key={event.id}><strong>{event.actorName}</strong> · {event.message}<small>{new Date(event.createdAt).toLocaleString()}</small></div>)}
    </div></div>
    {viewFile && <FieldFileViewer key={viewFile} id={viewFile} token={token} onClose={() => setViewFile(null)} />}
  </div>;
}

function StageCard({ stage, index, active, office, preview, finalReady, token, files, onView }: { stage: Stage; index: number; active: boolean; office: boolean; preview: boolean; finalReady: boolean; token?: string; files: Project["files"]; onView: (id: Id<"projectFiles">) => void }) {
  const completeTask = useMutation(api.field.setTaskCompleted);
  const addTask = useMutation(api.field.addTask);
  const removeTask = useMutation(api.field.removeTask);
  const submit = useMutation(api.field.submitStage);
  const review = useMutation(api.field.reviewStage);
  const blocker = useMutation(api.field.reportBlocker);
  const updateStage = useMutation(api.field.updateStage);
  const photoUpload = useMutation(api.field.createPhotoUpload);
  const [busy, setBusy] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploadTask, setUploadTask] = useState<Id<"projectTasks"> | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [retryUpload, setRetryUpload] = useState<{ taskId: Id<"projectTasks">; files: File[]; error: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const mutable = stage.status !== "submitted" && stage.status !== "verified" && !preview && !stage.archived;
  const fieldTasks = stage.tasks.filter(t => t.kind === "field" && !t.retired);
  const allFieldComplete = stage.final ? finalReady : fieldTasks.every(t => t.completed);
  const officeComplete = stage.tasks.filter(t => t.kind === "office").every(t => t.completed);
  const run = async (callback: () => Promise<unknown>, message?: string) => {
    if (busy) return; setBusy(true);
    try { await callback(); if (message) toast.success(message); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update this stage."); }
    finally { setBusy(false); }
  };
  const uploadPhotos = async (taskId: Id<"projectTasks">, selected: File[]) => {
    if (busy) return;
    if (selected.length > 6) { toast.error("Choose up to 6 photos at a time."); return; }
    setBusy(true); setRetryUpload(null);
    let index = 0;
    try {
      for (; index < selected.length; index++) {
        setUploadProgress({ current: index + 1, total: selected.length });
        const file = await prepareProgressPhoto(selected[index]!);
        const url = await photoUpload({ taskId, filename: file.name, token });
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 120_000);
        let response: Response;
        try { response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file, signal: controller.signal }); }
        catch { throw new Error("The upload could not finish. Check your connection and retry."); }
        finally { window.clearTimeout(timeout); }
        if (!response.ok) throw new Error("Upload failed. Check your connection and try again. If the office changed access, ask for a new project link.");
      }
      toast.success("Progress photos uploaded.");
    } catch (error) {
      setRetryUpload({ taskId, files: selected.slice(index), error: `${error instanceof Error ? error.message : "Could not upload this photo."} ${index ? `${index} earlier photo(s) saved.` : ""}` });
    } finally { setBusy(false); setUploadProgress(null); }
  };
  const selectedPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []); event.target.value = "";
    if (uploadTask && selected.length) void uploadPhotos(uploadTask, selected);
  };
  return <details className="fw-stage" data-status={stage.blocker ? "blocked" : stage.status} id={`stage-${stage.id}`} open={active || stage.status === "submitted" || !!stage.blocker}>
    <summary><span className="fw-number">{stage.status === "verified" ? <CheckIcon size={16} /> : String(index + 1).padStart(2, "0")}</span>
      <span className="fw-stage-heading"><h3>{stage.title}</h3><small>{stage.archived ? "Earlier stage record" : stage.final ? "Final completion review" : fieldTasks.length ? `${fieldTasks.filter(t => t.completed).length}/${fieldTasks.length} work items` : "Office requirements"}{stage.dueDate ? ` · Due ${stage.dueDate}` : ""}</small></span>
      <span className="fw-pill" data-status={stage.blocker ? "blocked" : stage.status}>{stage.blocker ? "Blocked" : STATUS_LABELS[stage.status]}</span><ChevronDownIcon size={15} />
    </summary>
    <div className="fw-stage-body">
      {stage.instructions && <p className="fw-note"><strong>Office notes</strong><br />{stage.instructions}</p>}
      {stage.blocker && <div className="fw-alert"><strong>Issue reported</strong>{stage.blocker}{mutable && <div className="fw-actions"><FieldButton className="fw-button" disabled={busy} onClick={() => void run(() => blocker({ stageId: stage.id, message: "", token }))}>Mark issue resolved</FieldButton></div>}</div>}
      {stage.reviewNote && <div className="fw-alert"><strong>Office review</strong>{stage.reviewNote}</div>}
      {(["field", "office"] as const).map(kind => <div key={kind}><h4 className="fw-group-label">{kind === "field" ? "Work required · Draw schedule" : "Inspection & draw requirements · Office updates"}</h4>
        {stage.tasks.filter(t => !t.retired && t.kind === kind).map(task => {
          const photos = files.filter(f => f.taskId === task.id);
          const canToggle = !preview && !stage.archived && !task.retired && (task.kind === "office" ? office : mutable);
          return <div className="fw-task" key={task.id}>
            <div className="fw-task-row"><label className="fw-check"><Checkbox aria-label={task.label} checked={task.completed} disabled={busy || !canToggle}
              onCheckedChange={completed => void run(() => completeTask({ taskId: task.id, completed, token }))} />
              <span>{task.label}{task.requiresPhoto && <small>{photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} attached` : "Completion photo required before checking off"}</small>}</span></label>
              {task.kind === "field" && !task.retired && mutable && <div className="fw-photo-actions"><FieldButton className="fw-button" disabled={busy} onClick={() => { setUploadTask(task.id); cameraRef.current?.click(); }}><CameraIcon />Take photo</FieldButton><FieldButton className="fw-button" disabled={busy} onClick={() => { setUploadTask(task.id); inputRef.current?.click(); }}>Choose photos</FieldButton></div>}
              {office && mutable && !task.scheduled && !task.retired && !photos.length && <FieldButton variant="destructive" className="fw-button" aria-label={`Remove requirement ${task.label}`} disabled={busy} onClick={() => void run(() => removeTask({ taskId: task.id }))}><Trash2Icon /></FieldButton>}
            </div>
            {!!photos.length && <div className="fw-files">{photos.map((file, i) => <FieldButton className="fw-button" key={file.id} onClick={() => onView(file.id)}><CameraIcon />Photo {i + 1}</FieldButton>)}</div>}
          </div>;
        })}
        {kind === "field" && !fieldTasks.length && <p className="fw-note">{stage.final ? "No additional construction work is listed for the final draw. The office must verify the earlier draws before final review." : "No field work is required for this draw. The office tracks its requirements below."}</p>}
      </div>)}
      {stage.status === "verified" && <p className="fw-note">{officeComplete ? "Construction verified. Office requirements are complete; the office can review draw submission readiness." : "Construction verified. Office requirements are still pending."}</p>}
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" aria-label="Choose progress photos" onChange={selectedPhotos} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take a progress photo" onChange={selectedPhotos} />
      {uploadProgress ? <div className="fw-upload-status" role="status" aria-live="polite"><strong>Uploading photo {uploadProgress.current} of {uploadProgress.total}</strong><progress max={uploadProgress.total} value={uploadProgress.current - 1} /><span>Keep this page open until your photos are saved.</span></div> : busy && <p role="status" className="fw-note">Saving changes…</p>}
      {retryUpload && <div className="fw-alert" role="alert"><strong>Some photos were not uploaded</strong>{retryUpload.error}<div className="fw-actions"><FieldButton className="fw-button" disabled={busy} onClick={() => void uploadPhotos(retryUpload.taskId, retryUpload.files)}>Retry {retryUpload.files.length} photo{retryUpload.files.length === 1 ? "" : "s"}</FieldButton><FieldButton className="fw-button" disabled={busy} onClick={() => setRetryUpload(null)}>Dismiss</FieldButton></div></div>}
      <div className="fw-actions">
        {mutable && <><FieldButton variant="default" className="fw-button" disabled={busy || !allFieldComplete || !!stage.blocker} onClick={() => void run(() => submit({ stageId: stage.id, token }), "Stage submitted for office review.")}><SendIcon />Submit for review</FieldButton>
          <FieldButton className="fw-button" disabled={busy} onClick={() => setShowIssue(!showIssue)}><TriangleAlertIcon />Report an issue</FieldButton></>}
        {office && mutable && <><FieldButton className="fw-button" onClick={() => setShowTaskForm(!showTaskForm)}><PlusIcon />Add office requirement</FieldButton><FieldButton className="fw-button" onClick={() => setEditing(!editing)}>Notes & due date</FieldButton></>}
        {office && stage.status === "submitted" && <FieldButton variant="default" className="fw-button" disabled={busy} onClick={() => void run(() => review({ stageId: stage.id, decision: "verified", note: "" }), "Construction verified.")}><CheckIcon />Verify construction</FieldButton>}
        {office && (stage.status === "submitted" || stage.status === "verified") && <FieldButton className="fw-button" onClick={() => setReviewing(!reviewing)}>{stage.status === "verified" ? "Reopen for changes" : "Request changes"}</FieldButton>}
      </div>
      {showIssue && mutable && <form className="fw-form" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async () => { await blocker({ stageId: stage.id, message: String(data.get("issue")), token }); setShowIssue(false); }, "Issue reported to the office.");
      }}><label>What is blocking progress?<Textarea className="fw-textarea" name="issue" maxLength={1000} required /></label><FieldButton className="fw-button" disabled={busy}>Save issue</FieldButton></form>}
      {reviewing && office && <form className="fw-form" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async () => { await review({ stageId: stage.id, decision: "changes_requested", note: String(data.get("note")) }); setReviewing(false); }, "Stage returned for changes.");
      }}><label>Tell the Field GC what needs to change<Textarea className="fw-textarea" name="note" maxLength={1000} required /></label><FieldButton className="fw-button" disabled={busy}>Return to Field GC</FieldButton></form>}
      {showTaskForm && office && mutable && <form className="fw-form" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async () => { await addTask({ stageId: stage.id, label: String(data.get("label")), kind: "office", requiresPhoto: false }); setShowTaskForm(false); });
      }}><label>Office requirement visible to the Field GC<Input className="fw-input" name="label" maxLength={240} required placeholder="Example: Rough-in inspection approved" /></label>
        <FieldButton className="fw-button" disabled={busy}>Add office requirement</FieldButton></form>}
      {editing && office && mutable && <form className="fw-form" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void run(async () => { await updateStage({ stageId: stage.id, title: String(data.get("title")), instructions: String(data.get("instructions")), dueDate: String(data.get("dueDate")) }); setEditing(false); });
      }}><label>Stage from the draw schedule<Input className="fw-input" name="title" value={stage.title} readOnly /></label>
        <label>Office notes visible to the Field GC<Textarea className="fw-textarea" name="instructions" defaultValue={stage.instructions} maxLength={3000} /></label>
        <label>Due date<Input type="date" className="fw-input" name="dueDate" defaultValue={stage.dueDate ?? ""} /></label><FieldButton className="fw-button" disabled={busy}>Save stage</FieldButton></form>}
    </div>
  </details>;
}
