import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";

import type { VerifiedData } from "@/components/wizard/verify-step";

const STORAGE_KEY = "sah:invoice-draft";

export type InvoiceDraft = {
  invoiceStorageId: Id<"_storage">;
  data: VerifiedData;
};

export function writeInvoiceDraft(workspaceId: string, draft: InvoiceDraft) {
  sessionStorage.setItem(
    `${STORAGE_KEY}:${workspaceId}`,
    JSON.stringify(draft),
  );
}

export function consumeInvoiceDraft(workspaceId: string): InvoiceDraft | null {
  const key = `${STORAGE_KEY}:${workspaceId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  sessionStorage.removeItem(key);
  try {
    return JSON.parse(raw) as InvoiceDraft;
  } catch {
    return null;
  }
}
