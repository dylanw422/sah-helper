import { parsePlan, type Plan } from "./model";
import type { PlanStage, SavedPlanStage } from "@sah-helper/backend/convex/lib/planStages";
export type { PlanStage, SavedPlanStage };
export const STAGE_NAMES = { before: "Before", after: "After", archive: "Previous plan" };

export type PlanClient = { id: string; name: string; street: string; city: string; state: string; caseNumber: string };
export type NewPlanClient = { name: string; street: string; city: string; state: string; zip: string; phone: string; caseNumber: string; drawCount: 4 | 5 | 6 };
export type SavedClientPlan = { id: string; clientId: string; clientName: string; stage: SavedPlanStage; draftId: string; name: string; revision: number; updatedAt: number; wallCount: number; fixtureCount: number };
export type ClientPlanLink = SavedClientPlan & { fingerprint: string };
export type ClientPlanGateway = {
  clients: PlanClient[] | undefined;
  plans: SavedClientPlan[] | undefined;
  save: (plan: Plan, clientId: string, expectedRevision: number, stage?: PlanStage) => Promise<SavedClientPlan>;
  saveToNewClient: (plan: Plan, client: NewPlanClient, expectedRevision: number, requestId: string) => Promise<SavedClientPlan>;
  get: (id: string) => Promise<{ plan: Plan; summary: SavedClientPlan }>;
  start: (clientId: string, stage: PlanStage, expectedBeforeRevision?: number) => Promise<{ plan: Plan; summary: SavedClientPlan }>;
};

// A compact change detector for local sync metadata. Normalize property ordering
// and ignore the draft timestamp so undoing back to a saved plan stays clean.
export function planFingerprint(plan: Plan): string {
  const text = JSON.stringify({ ...parsePlan(plan), updatedAt: 0 });
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489909); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function clientPlanError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  }
  return error instanceof Error ? error.message : "The client plan could not be saved. Your local draft is kept.";
}
