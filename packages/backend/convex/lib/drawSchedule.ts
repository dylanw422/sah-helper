// Draw schedule rules:
// - Line items sum to the full contract total.
// - The final draw is a 20% holdback of the contract total (not built from line items).
// - Line items mentioning "Profit" are part of the contract total but are NOT
//   assigned to any draw — profit is considered built into the 20% holdback,
//   so it never appears on the draw/payment schedules.
// - Draws 1..N-2 are exact sums of their assigned line items.
// - Draw N-1 takes the remaining schedulable line items but pays only what's
//   left of the contract (80% of total minus the earlier draws) — its line
//   items exceed its paid amount by the holdback minus any profit items.
// - Each line item is assigned to exactly one draw, preserving the given order
//   (contiguous groups). Items arrive pre-sorted in construction sequence —
//   demo before install, etc. — so each draw covers a coherent phase of work.
// - Draw 1 must be less than 20% of the contract total.
// - Every draw (including the holdback) must be less than $40,000.

const MAX_DRAW_CENTS = 4_000_000; // $40,000

export type DrawSchedule = {
  /** Length = drawCount. Dollars. Last entry is the 20% holdback. */
  drawAmounts: number[];
  /** Line item indices per draw, for draws 1..N-1. */
  groups: number[][];
  holdback: number;
  total: number;
};

export function buildDrawSchedule(
  lineItems: { description: string; amount: number }[],
  drawCount: number,
): DrawSchedule {
  const itemCents = lineItems.map((item) => Math.round(item.amount * 100));
  const totalCents = itemCents.reduce((sum, c) => sum + c, 0);
  const holdbackCents = Math.round(totalCents * 0.2);
  const groupCount = drawCount - 1;

  // Profit is built into the holdback — keep it in the total, but never
  // assign it to a draw.
  const schedulable = lineItems
    .map((_, i) => i)
    .filter((i) => !/profit/i.test(lineItems[i].description));

  if (totalCents <= 0) {
    throw new Error("Cannot build a draw schedule: line items total $0.");
  }
  if (holdbackCents >= MAX_DRAW_CENTS) {
    throw new Error(
      `Cannot build a draw schedule: the 20% holdback would be ${fmt(holdbackCents)}, but every draw must be under $40,000. The contract is too large.`,
    );
  }
  if (schedulable.length < groupCount) {
    throw new Error(
      `Cannot build a draw schedule: ${drawCount} draws need at least ${groupCount} line items (the final draw is the 20% holdback, and "Profit" items are folded into it), but the invoice has ${schedulable.length} schedulable.`,
    );
  }

  // Enumerate every way to split the line items (kept in construction order) into
  // N-1 contiguous non-empty groups; keep the most balanced valid split.
  // Groups 1..N-2 pay their exact item sum; the last group pays the remainder
  // (total - holdback - earlier draws).
  let best: { paid: number[]; groups: number[][]; maxPaid: number } | null = null;

  const recurse = (start: number, groupsLeft: number, sums: number[], groups: number[][]) => {
    if (groupsLeft === 1) {
      consider(sums, [...groups, schedulable.slice(start)]);
      return;
    }
    let sum = 0;
    // Leave at least one item per remaining group
    for (let end = start + 1; end <= schedulable.length - (groupsLeft - 1); end++) {
      sum += itemCents[schedulable[end - 1]];
      recurse(end, groupsLeft - 1, [...sums, sum], [...groups, schedulable.slice(start, end)]);
    }
  };

  const consider = (exactSums: number[], groups: number[][]) => {
    const remainder =
      totalCents - holdbackCents - exactSums.reduce((s, c) => s + c, 0);
    if (remainder <= 0) return; // draw N-1 must pay something
    const paid = [...exactSums, remainder];
    if (paid[0] >= holdbackCents) return; // draw 1 must be < 20% of total
    const maxPaid = Math.max(...paid);
    if (maxPaid >= MAX_DRAW_CENTS) return;
    if (!best || maxPaid < best.maxPaid) {
      best = { paid, groups, maxPaid };
    }
  };

  recurse(0, groupCount, [], []);

  if (!best) {
    throw new Error(
      `Cannot build a valid ${drawCount}-draw schedule: no way to split the line items keeps Draw 1 under 20% of the contract total (${fmt(holdbackCents)}) and every draw under $40,000. Try a different draw count or adjust the line items.`,
    );
  }

  const { paid, groups } = best as { paid: number[]; groups: number[][] };
  return {
    drawAmounts: [...paid, holdbackCents].map((c) => c / 100),
    groups,
    holdback: holdbackCents / 100,
    total: totalCents / 100,
  };
}

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
