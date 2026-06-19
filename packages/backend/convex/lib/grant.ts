// VA SAH (Specially Adapted Housing) maximum grant amount for FY2026.
// The grant pays the full contract total (line items + profit), so the cap is
// checked against the invoice *total*, profit included.
export const MAX_GRANT_AMOUNT = 126_526;

export function grantBand(total: number): "ok" | "near" | "over" {
  if (total >= MAX_GRANT_AMOUNT) return "over";
  if (total >= MAX_GRANT_AMOUNT * 0.9) return "near";
  return "ok";
}
