export const MAX_GRANT_AMOUNT = 126_526;
export const MIN_TARGET_AMOUNT = 115_000;

export function targetInvoiceAmount(maximumInvoiceAmount: number): number {
  return Math.min(MIN_TARGET_AMOUNT, Math.round(maximumInvoiceAmount * 0.9));
}

export function grantBand(total: number, maximumInvoiceAmount = MAX_GRANT_AMOUNT): "under" | "ok" | "over" {
  if (total > maximumInvoiceAmount) return "over";
  if (total >= targetInvoiceAmount(maximumInvoiceAmount)) return "ok";
  return "under";
}
