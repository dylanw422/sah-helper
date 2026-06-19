export const MAX_GRANT_AMOUNT = 126_526;

export function grantBand(total: number): "ok" | "near" | "over" {
  if (total >= MAX_GRANT_AMOUNT) return "over";
  if (total >= MAX_GRANT_AMOUNT * 0.9) return "near";
  return "ok";
}
