import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";

import type { VerifiedData } from "@/components/wizard/verify-step";

const STORAGE_KEY = "sah:invoice-draft";

export type InvoiceDraft = {
  invoiceStorageId: Id<"_storage">;
  data: VerifiedData;
};

export function writeInvoiceDraft(draft: InvoiceDraft) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function consumeInvoiceDraft(): InvoiceDraft | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    return JSON.parse(raw) as InvoiceDraft;
  } catch {
    return null;
  }
}
