"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Textarea } from "@sah-helper/ui/components/textarea";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { LineItemRow } from "@/components/invoice/line-items-editor";
import { formatCurrency } from "@/lib/format";

export function SaveAsBundle({ open, onClose, rows, documents }: {
  open: boolean;
  onClose: () => void;
  rows: LineItemRow[];
  documents: {
    waiverIds?: Id<"customDocuments">[];
    specSheetIds?: Id<"customDocuments">[];
    jobSpecificIds?: Id<"customDocuments">[];
  };
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const create = useMutation(api.bundles.createBundle);
  const library = useQuery(api.customDocuments.listCustomDocuments, open ? {} : "skip");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Id<"customDocuments">[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setName(""); setDescription("");
    setSelectedRows(rows.filter(row => row.description.trim()).map(row => row.id));
    setSelectedDocs([...new Set([...(documents.waiverIds ?? []), ...(documents.specSheetIds ?? []), ...(documents.jobSpecificIds ?? [])])]);
    // The invoice snapshot is taken when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const invoiceDocs = [...new Set([...(documents.waiverIds ?? []), ...(documents.specSheetIds ?? []), ...(documents.jobSpecificIds ?? [])])];
  const save = async () => {
    try {
      if (!name.trim() || name.trim().length > 100) throw new Error("Enter a bundle name of at most 100 characters.");
      const chosen = rows.filter(row => selectedRows.includes(row.id));
      if (!chosen.length || chosen.length > 100) throw new Error("Choose 1–100 regular invoice rows.");
      const items = chosen.map((row, index) => {
        const quantity = Number(row.qty), price = Number(row.unitPrice);
        if (!row.description.trim() || row.description.trim().length > 500 || /^profit$/i.test(row.description.trim())) throw new Error(`Check description for item ${index + 1}.`);
        if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(Math.round(quantity * 1000) - quantity * 1000) > 1e-7) throw new Error(`Check quantity for item ${index + 1}.`);
        if (!Number.isFinite(price) || price < 0 || Math.abs(Math.round(price * 100) - price * 100) > 1e-7) throw new Error(`Check unit price for item ${index + 1}.`);
        return { description: row.description.trim(), quantity, unitPriceCents: Math.round(price * 100) };
      });
      setSaving(true);
      await create({ name: name.trim(), description: description.trim(), items, documentIds: selectedDocs });
      toast.success("Bundle saved. Your invoice was not changed.");
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save bundle."); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialogRef} onClose={onClose} className="m-auto max-h-[90vh] w-[min(94vw,620px)] rounded-lg border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60">
    <div className="border-b px-5 py-4"><h2 className="text-base font-semibold">Save as Bundle</h2><p className="mt-1 text-xs text-muted-foreground">Remove client-specific details before saving this bundle.</p></div>
    <div className="max-h-[calc(90vh-138px)] space-y-5 overflow-y-auto px-5 py-5">
      <div className="space-y-1"><Label htmlFor="new-bundle-name">Bundle name</Label><Input id="new-bundle-name" autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="new-bundle-description">Internal description</Label><Textarea id="new-bundle-description" maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></div>
      <fieldset className="space-y-2"><legend className="text-xs font-semibold">Invoice rows to include</legend>{rows.map(row => <label key={row.id} className="flex items-start gap-2 rounded-md border p-2 text-xs"><input type="checkbox" checked={selectedRows.includes(row.id)} onChange={event => setSelectedRows(event.target.checked ? [...selectedRows, row.id] : selectedRows.filter(id => id !== row.id))} /><span className="flex-1">{row.description || "Unnamed row"}</span><span>{formatCurrency(Math.round((Number(row.qty) || 0) * (Number(row.unitPrice) || 0) * 100) / 100)}</span></label>)}</fieldset>
      <fieldset className="space-y-2"><legend className="text-xs font-semibold">Selected supporting documents</legend>{invoiceDocs.length === 0 && <p className="text-xs text-muted-foreground">No supporting documents are selected on this invoice.</p>}{invoiceDocs.map(id => {
        const doc = library?.find(item => item._id === id);
        return <label key={id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedDocs.includes(id)} onChange={event => setSelectedDocs(event.target.checked ? [...selectedDocs, id] : selectedDocs.filter(selected => selected !== id))} /><span>{doc?.displayName ?? "Unavailable document"}</span></label>;
      })}</fieldset>
    </div>
    <div className="flex justify-end gap-2 border-t px-5 py-4"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Bundle"}</Button></div>
  </dialog>;
}
