// VA SAH (Specially Adapted Housing) maximum grant amount for FY2026.
// The grant pays the full contract total (line items + profit), so the cap is
// checked against the invoice *total*, profit included.
export const MAX_GRANT_AMOUNT = 126_526;
export const MIN_TARGET_AMOUNT = 115_000;

export function grantBand(total: number): "under" | "ok" | "over" {
  if (total >= MAX_GRANT_AMOUNT) return "over";
  if (total >= MIN_TARGET_AMOUNT) return "ok";
  return "under";
}
