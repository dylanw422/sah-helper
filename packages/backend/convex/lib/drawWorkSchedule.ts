import { buildDrawSchedule, type DrawSchedule } from "./drawSchedule";

export type DrawWorkStage = { drawNumber: number; items: { lineItemIndex: number; description: string }[] };

// Both the PDF fields and field checklists use these original, unsplit
// descriptions. Commas within a work description are never treated as rows.
export function drawWorkFromSchedule(schedule: DrawSchedule, lineItems: { description: string }[]): DrawWorkStage[] {
  return schedule.drawAmounts.map((_, index) => ({
    drawNumber: index + 1,
    items: (schedule.groups[index] ?? []).map(lineItemIndex => ({ lineItemIndex, description: lineItems[lineItemIndex]!.description })),
  }));
}

export function buildDrawWorkSchedule(lineItems: { description: string; amount: number }[], drawCount: number) {
  return drawWorkFromSchedule(buildDrawSchedule(lineItems, drawCount), lineItems);
}

// Apply only after the full draw schedule is calculated. Removing these rows
// before grouping would move construction work into different draws.
export function isOfficeOnlyDrawWork(description: string) {
  return /insurance|liability|\bplans?\s*(?:and|&)\s*spec(?:ification)?s?\s+job\b/i.test(description);
}

export function fieldDrawWorkSchedule(schedule: DrawWorkStage[]): DrawWorkStage[] {
  return schedule.map(draw => ({ ...draw, items: draw.items.filter(item => !isOfficeOnlyDrawWork(item.description)) }));
}

export function drawWorkDescription(stage: DrawWorkStage) { return stage.items.map(item => item.description).join(", "); }
export function drawWorkTitle(stage: DrawWorkStage, drawCount: number) { return stage.drawNumber === drawCount ? `Draw ${stage.drawNumber} · Final completion` : `Draw ${stage.drawNumber}`; }
export function drawWorkKey(stage: DrawWorkStage, drawCount: number) { return JSON.stringify({ version: 1, drawCount, ...stage }); }
export function drawItemKey(item: DrawWorkStage["items"][number]) { return JSON.stringify([item.lineItemIndex, item.description]); }
