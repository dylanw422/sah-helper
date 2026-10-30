import { useSyncExternalStore, type ReactNode } from "react";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { Id } from "../../packages/backend/convex/_generated/dataModel";
import { buildDrawWorkSchedule, drawWorkTitle, fieldDrawWorkSchedule } from "../../packages/backend/convex/lib/drawWorkSchedule";
import type { api } from "../../packages/backend/convex/_generated/api";

type Project = FunctionReturnType<typeof api.field.getProject>;
const sampleItems = ["Demolition, debris removal", "Framing and backing", "Plumbing rough-in", "Electrical rough-in", "Accessible fixtures", "Finishes and paint"].map((description, i) => ({ description, amount: [10000, 10000, 19500, 19500, 20500, 20500][i]! }));
const sampleSchedule = fieldDrawWorkSchedule(buildDrawWorkSchedule([
  { description: "Plan and Spec Job", amount: 1000 }, { description: "General liability insurance", amount: 1000 },
  ...sampleItems, { description: "Profit", amount: 23456 },
], 4));
const project = {
  project: { id: "client-demo", name: "Oak Street adaptation", address: "148 Oak Street, Arp, TX" }, office: false, needsScheduleSync: false, scheduleError: null,
  stages: sampleSchedule.map((draw, i) => ({
    id: `stage-${i}`, title: drawWorkTitle(draw, 4), instructions: "", drawNumber: draw.drawNumber, final: draw.drawNumber === 4, archived: false,
    status: "not_started", dueDate: null, blocker: null, reviewNote: null,
    tasks: [
      ...draw.items.map((item, j) => ({ id: `work-task-${i}-${j}`, label: item.description, kind: "field", requiresPhoto: true, completed: false, retired: false, scheduled: true })),
      { id: `office-task-${i}`, label: "Inspection requirements satisfied", kind: "office", requiresPhoto: false, completed: false, retired: false, scheduled: false },
      { id: `docs-task-${i}`, label: "Required completion paperwork received", kind: "office", requiresPhoto: false, completed: false, retired: false, scheduled: false },
    ],
  })), files: [], activity: [],
} as Project;
const key = "sah-helper:field-filtered-draw-schedule-test";
let state: Project & { testLinkActive?: boolean } = JSON.parse(localStorage.getItem(key) ?? "null") ?? project;
const listeners = new Set<() => void>();
const office = () => new URLSearchParams(location.search).get("office") === "1";
const change = () => { state = structuredClone(state); localStorage.setItem(key, JSON.stringify(state)); for (const listener of listeners) listener(); };
const notify = (type: string, message: string, stageId?: Id<"projectStages">) => state.activity.unshift({ id: crypto.randomUUID() as Id<"projectActivity">, actorName: office() ? "Office team" : "BuildCo (project link)", type, message, stageId: stageId ?? null, createdAt: Date.now() });
const getSnapshot = () => state;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useQuery<Q extends FunctionReference<"query">>(reference: Q): FunctionReturnType<Q> {
  useSyncExternalStore(subscribe, getSnapshot);
  let result: unknown;
  switch (getFunctionName(reference)) {
    case "field:current": result = { mode: office() ? "office" : "field", name: "BuildCo (project link)" }; break;
    case "field:linkProject": result = state.testLinkActive === false ? null : { project: state.project, label: "BuildCo" }; break;
    case "field:getProject": result = { ...state, office: office() }; break;
    case "field:listProjects": result = [{ ...state.project, stageCount: state.stages.length, verifiedCount: state.stages.filter(s => s.status === "verified").length, submittedCount: state.stages.filter(s => s.status === "submitted").length, blockerCount: state.stages.filter(s => s.blocker).length, nextStage: state.stages.find(s => s.status !== "verified")?.title ?? null, updatedAt: Date.now() }]; break;
    case "field:projectTeam": result = { link: state.testLinkActive === false ? null : { id: "project-link-demo", label: "BuildCo", createdAt: Date.now() } }; break;
    case "clientFiles:listClientFiles": result = []; break;
    case "field:notifications": result = { items: state.activity.map(e => ({ ...e, clientId: state.project.id, projectName: state.project.name, read: false })), hasOlder: false }; break;
    default: throw new Error(`Unexpected test query: ${getFunctionName(reference)}`);
  }
  return result as FunctionReturnType<Q>;
}
type Args = { taskId?: string; stageId?: string; completed?: boolean; message?: string; decision?: "verified" | "changes_requested"; note?: string; label?: string; kind?: "office" | "field"; requiresPhoto?: boolean; title?: string; instructions?: string; dueDate?: string };
const functions = new Map<string, (args: Args) => Promise<unknown>>();
export function useMutation<M extends FunctionReference<"mutation">>(reference: M) {
  const name = getFunctionName(reference);
  if (!functions.has(name)) functions.set(name, async (args: Args) => {
    const stage = state.stages.find(s => s.id === args.stageId || s.tasks.some(t => t.id === args.taskId));
    const task = stage?.tasks.find(t => t.id === args.taskId);
    switch (name) {
      case "field:syncProjectSchedule": return null;
      case "field:createPhotoUpload": return `/test-photo?task=${args.taskId}`;
      case "field:setTaskCompleted":
        if (!task || !stage) throw new Error("Requirement not found");
        if (task.requiresPhoto && args.completed && !state.files.some(f => f.taskId === task.id)) throw new Error("Upload a completion photo first.");
        task.completed = !!args.completed; if (stage.status === "not_started") stage.status = "in_progress"; notify("task_updated", `${task.completed ? "Completed" : "Reopened"}: ${task.label}`, stage.id); break;
      case "field:submitStage":
        if (!stage) throw new Error("Stage not found"); stage.status = "submitted"; notify("stage_submitted", `${stage.title} submitted for office review.`, stage.id); break;
      case "field:reportBlocker":
        if (!stage) throw new Error("Stage not found"); stage.blocker = args.message || null; notify(args.message ? "blocked" : "blocker_resolved", args.message ? `Reported a blocker: ${args.message}` : "Blocker resolved.", stage.id); break;
      case "field:reviewStage":
        if (!stage) throw new Error("Stage not found"); stage.status = args.decision!; stage.reviewNote = args.note || null; notify(args.decision!, args.decision === "verified" ? `${stage.title} verified.` : args.note!, stage.id); break;
      case "field:addTask":
        if (!stage) throw new Error("Stage not found"); stage.tasks.push({ id: crypto.randomUUID() as Id<"projectTasks">, label: args.label!, kind: args.kind!, requiresPhoto: !!args.requiresPhoto, completed: false, retired: false, scheduled: false }); break;
      case "field:removeTask": if (stage) stage.tasks = stage.tasks.filter(t => t.id !== args.taskId); break;
      case "field:updateStage": if (stage) Object.assign(stage, { title: args.title, instructions: args.instructions, dueDate: args.dueDate || null }); break;
      case "field:createProjectLink": state.testLinkActive = true; change(); return { token: "isolated-project-link" };
      case "field:revokeProjectLink": state.testLinkActive = false; break;
      case "field:markNotificationsRead": break;
      default: throw new Error(`Unexpected test mutation: ${name}`);
    }
    change(); return null;
  });
  return functions.get(name)! as (args: M["_args"]) => Promise<FunctionReturnType<M>>;
}
const pixel = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVhsAAAAASUVORK5CYII="), c => c.charCodeAt(0));
const readFile = async () => ({ bytes: pixel.buffer, filename: "progress.png", contentType: "image/png" });
export const useAction = () => readFile;
export const Authenticated = ({ children }: { children: ReactNode }) => children;
export const Unauthenticated = () => null;
export const AuthLoading = () => null;
let failNextUpload = new URLSearchParams(location.search).get("fail-upload") === "once";
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (typeof input !== "string" || !input.startsWith("/test-photo")) return realFetch(input, init);
  if (failNextUpload) { failNextUpload = false; return new Response("Simulated connection failure", { status: 503 }); }
  const taskId = new URL(input, location.origin).searchParams.get("task");
  const stage = state.stages.find(s => s.tasks.some(t => t.id === taskId))!;
  const fileId = crypto.randomUUID() as Id<"projectFiles">;
  state.files.push({ id: fileId, taskId: taskId as Id<"projectTasks">, stageId: stage.id, filename: "progress.png", kind: "photo", uploadedByName: "BuildCo (project link)", createdAt: Date.now() });
  notify("photo_added", "Added a progress photo.", stage.id); change();
  return Response.json({ id: fileId });
};
