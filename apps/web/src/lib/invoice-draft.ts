import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";

import type { VerifiedData } from "@/components/wizard/verify-step";

const STORAGE_KEY = "sah:invoice-draft";
const REVISION_STORAGE_KEY = "sah:invoice-revision";

export type InvoiceDraft = {
  invoiceStorageId: Id<"_storage">;
  data: VerifiedData;
  invoiceId?: Id<"invoices">;
  invoiceDate?: string;
};

export type InvoiceRevisionDraft = {
  data: VerifiedData;
  invoiceDate?: string;
  invoiceId?: Id<"invoices">;
};

export function writeInvoiceRevisionDraft(workspaceId: string, draft: InvoiceRevisionDraft) {
  sessionStorage.setItem(`${REVISION_STORAGE_KEY}:${workspaceId}`, JSON.stringify(draft));
}

export function consumeInvoiceRevisionDraft(
  workspaceId: string,
  invoiceId?: Id<"invoices">,
): InvoiceRevisionDraft | null {
  const key = `${REVISION_STORAGE_KEY}:${workspaceId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as InvoiceRevisionDraft;
    if (draft.invoiceId !== invoiceId) return null;
    sessionStorage.removeItem(key);
    return draft;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

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
