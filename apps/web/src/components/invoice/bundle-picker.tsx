"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { usePaginatedQuery, useQuery } from "convex/react";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { LineItemRow } from "@/components/invoice/line-items-editor";
import { formatCurrency } from "@/lib/format";

type Review = {
  id: Id<"bundles">;
  name: string;
  revision: number;
  rows: LineItemRow[];
  documents: { documentId: Id<"customDocuments">; displayName: string; available: boolean; category: "waiver" | "spec-sheet" | "job-specific" }[];
};

export function BundlePicker({ open, onClose, onApply, currentSubtotal, profitPct, currentItemCount, currentDocumentIds, appliedIds }: {
  open: boolean;
  onClose: () => void;
  onApply: (bundleId: Id<"bundles">, rows: LineItemRow[], documents: Review["documents"]) => void;
  currentSubtotal: number;
  profitPct: number;
  currentItemCount: number;
  currentDocumentIds: Id<"customDocuments">[];
  appliedIds: Id<"bundles">[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<Id<"bundles"> | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [continueWithoutMissing, setContinueWithoutMissing] = useState(false);
  const [applying, setApplying] = useState(false);
  const { results, status, loadMore } = usePaginatedQuery(api.bundles.listBundles, open ? { search } : "skip", { initialNumItems: 20 });
  const detail = useQuery(api.bundles.getBundle, open && selectedId ? { id: selectedId } : "skip");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!detail || review || detail._id !== selectedId) return;
    setReview({
      id: detail._id, name: detail.name, revision: detail.revision,
      rows: detail.items.map(item => ({ id: crypto.randomUUID(), description: item.description, qty: String(item.quantity), unitPrice: String(item.unitPriceCents / 100) })),
      documents: detail.documents.map(doc => ({ documentId: doc.documentId, displayName: doc.displayName, available: doc.available, category: doc.categorySnapshot })),
    });
  }, [detail, review, selectedId]);
  useEffect(() => {
    if (open) return;
    setSelectedId(null); setReview(null); setContinueWithoutMissing(false); setSearch("");
  }, [open]);

  const missing = review?.documents.filter(doc => !doc.available || detail?.documents.find(current => current.documentId === doc.documentId)?.available === false) ?? [];
  const subtotal = (review?.rows.reduce((sum, row) => sum + Math.round((Number(row.qty) || 0) * (Number(row.unitPrice) || 0) * 100), 0) ?? 0) / 100;
  const projectedSubtotal = Math.round((currentSubtotal + subtotal) * 100) / 100;
  const projected = projectedSubtotal + Math.round(projectedSubtotal * profitPct) / 100;
  const apply = () => {
    if (!review || applying) return;
    try {
      if (detail === null) throw new Error("This bundle was deleted. Choose another bundle.");
      if (review.rows.length + currentItemCount > 100) throw new Error("The invoice would exceed 100 work items.");
      if (new Set([...currentDocumentIds, ...review.documents.filter(doc => !missing.some(m => m.documentId === doc.documentId)).map(doc => doc.documentId)]).size > 50) throw new Error("The invoice would exceed 50 supporting documents.");
      if (missing.length && !continueWithoutMissing) throw new Error("Remove missing documents or choose to continue without them.");
      for (const [index, row] of review.rows.entries()) {
        const qty = Number(row.qty), price = Number(row.unitPrice);
        if (!Number.isFinite(qty) || qty <= 0 || Math.abs(Math.round(qty * 1000) - qty * 1000) > 1e-7 ||
            !Number.isFinite(price) || price < 0 || Math.abs(Math.round(price * 100) - price * 100) > 1e-7)
          throw new Error(`Check quantity and price for item ${index + 1}.`);
      }
      setApplying(true);
      onApply(review.id, review.rows.map(row => ({ ...row, id: crypto.randomUUID() })), review.documents.filter(doc => !missing.some(m => m.documentId === doc.documentId)));
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add bundle."); }
    finally { setApplying(false); }
  };

  return (
    <dialog ref={dialogRef} onClose={onClose} className="m-auto max-h-[90vh] w-[min(94vw,760px)] rounded-lg border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
      <div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-base font-semibold">Add Bundle</h2><Button variant="ghost" size="icon-sm" aria-label="Close bundle picker" onClick={onClose}><XIcon className="size-4" /></Button></div>
      <div className="max-h-[calc(90vh-138px)] overflow-y-auto px-5 py-5">
        {!selectedId ? <div className="space-y-4">
          <Input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search bundles" aria-label="Search bundles" />
          {status === "LoadingFirstPage" && <p className="text-xs text-muted-foreground">Loading bundles…</p>}
          {status !== "LoadingFirstPage" && results.length === 0 && <p className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">{search ? "No matching bundles." : "No bundles yet. Create one from the Bundles page."}</p>}
          <div className="space-y-2">{results.map(bundle => <button type="button" key={bundle._id} onClick={() => setSelectedId(bundle._id)} className="w-full rounded-md border px-4 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <span className="block text-sm font-medium">{bundle.name}</span>
            {bundle.description && <span className="mt-1 block text-xs text-muted-foreground">{bundle.description}</span>}
            <span className="mt-2 block text-[11px] text-muted-foreground">{bundle.itemCount} items · {bundle.documentCount} documents · {formatCurrency(bundle.subtotalCents / 100)} before profit</span>
          </button>)}</div>
          {status === "CanLoadMore" && <Button variant="outline" size="sm" onClick={() => loadMore(20)}>Load more</Button>}
        </div> : detail === null ? <div className="space-y-3 text-xs"><p>This bundle was deleted. Choose another bundle.</p><Button variant="outline" size="sm" onClick={() => { setSelectedId(null); setReview(null); }}>All bundles</Button></div> : !review ? <p className="text-xs text-muted-foreground">Loading bundle…</p> : <div className="space-y-5">
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => { setSelectedId(null); setReview(null); }}><ArrowLeftIcon className="size-3" /> All bundles</button>
          <div><h3 className="text-sm font-semibold">{review.name}</h3><p className="mt-1 text-xs text-muted-foreground">Review quantities and prices for this job. Changes here will not change the bundle.</p></div>
          <div className="space-y-2">{review.rows.map((row, index) => <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_75px_105px] gap-2">
            <span className="self-center text-xs">{index + 1}. {row.description}</span>
            <Input type="number" min="0.001" step="0.001" aria-label={`${row.description} quantity`} value={row.qty} onChange={event => setReview({ ...review, rows: review.rows.map(item => item.id === row.id ? { ...item, qty: event.target.value } : item) })} />
            <Input type="number" min="0" step="0.01" aria-label={`${row.description} unit price`} value={row.unitPrice} onChange={event => setReview({ ...review, rows: review.rows.map(item => item.id === row.id ? { ...item, unitPrice: event.target.value } : item) })} />
          </div>)}</div>
          <div className="rounded-md bg-muted/50 p-3 text-xs"><p>Adds {review.rows.length} items · {formatCurrency(subtotal)} before profit</p><p className="mt-1 font-semibold">Projected invoice total: {formatCurrency(projected)} (includes {profitPct}% profit)</p></div>
          <div><h4 className="mb-2 text-xs font-semibold">Supporting documents</h4>{review.documents.length === 0 && <p className="text-xs text-muted-foreground">No documents attached.</p>}
            {review.documents.map(doc => { const available = !missing.some(m => m.documentId === doc.documentId); return <p key={doc.documentId} className={`text-xs ${available ? "text-muted-foreground" : "text-amber-600"}`}>{available ? "✓" : "⚠"} {doc.displayName}{!available && " — unavailable"}</p>; })}
            {missing.length > 0 && <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={continueWithoutMissing} onChange={event => setContinueWithoutMissing(event.target.checked)} /> Continue without the unavailable documents</label>}
          </div>
          {appliedIds.includes(review.id) && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">This bundle was already added during this editing session. Adding again creates another copy of its items.</p>}
        </div>}
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-4"><Button variant="outline" onClick={onClose}>Cancel</Button>{review && detail !== null && <Button disabled={applying || (missing.length > 0 && !continueWithoutMissing)} onClick={apply}>{appliedIds.includes(review.id) ? "Add Again" : "Add to Invoice"}</Button>}</div>
    </dialog>
  );
}
