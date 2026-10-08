export type PlanStage = "before" | "after";
export type SavedPlanStage = PlanStage | "archive";

// Older clients could have many plans. Keep all documents, assigning the oldest
// two to the workflow and preserving extra plans as an accessible archive.
export function resolvePlanStages<T extends { _id: string; stage?: SavedPlanStage; createdAt: number; _creationTime: number }>(records: T[]) {
  const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime || a._id.localeCompare(b._id));
  const stages = new Map<string, SavedPlanStage>();
  const taken = new Set<PlanStage>();
  for (const record of ordered) {
    if (!record.stage) continue;
    if (record.stage !== "archive" && !taken.has(record.stage)) { stages.set(record._id, record.stage); taken.add(record.stage); }
    else stages.set(record._id, "archive");
  }
  for (const record of ordered) {
    if (stages.has(record._id)) continue;
    const stage = !taken.has("before") ? "before" : !taken.has("after") ? "after" : "archive";
    stages.set(record._id, stage);
    if (stage !== "archive") taken.add(stage);
  }
  return stages;
}
