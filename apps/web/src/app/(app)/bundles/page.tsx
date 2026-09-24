"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Textarea } from "@sah-helper/ui/components/textarea";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { BundleDocuments } from "@/components/invoice/bundle-documents";
import { formatCurrency } from "@/lib/format";

type BundleRow = { id: string; description: string; quantity: string; unitPrice: string };
type BundleForm = {
  name: string; description: string; rows: BundleRow[]; documentIds: Id<"customDocuments">[];
};
const blankRow = (): BundleRow => ({ id: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "0" });
const blankForm = (): BundleForm => ({ name: "", description: "", rows: [blankRow()], documentIds: [] });

function bundlePayload(form: BundleForm) {
  if (form.documentIds.length > 50) throw new Error("Choose at most 50 documents.");
  if (!form.name.trim() || form.name.trim().length > 100) throw new Error("Enter a bundle name of at most 100 characters.");
  if (form.rows.length < 1 || form.rows.length > 100) throw new Error("A bundle needs 1–100 items.");
  return {
    name: form.name.trim(), description: form.description.trim(), documentIds: form.documentIds,
    items: form.rows.map((row, index) => {
      const quantity = Number(row.quantity);
      const price = Number(row.unitPrice);
      if (!row.description.trim() || row.description.trim().length > 500 || /^profit$/i.test(row.description.trim()))
        throw new Error(`Item ${index + 1} needs a description (not Profit) of at most 500 characters.`);
      if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(Math.round(quantity * 1000) - quantity * 1000) > 1e-7)
        throw new Error(`Item ${index + 1} needs a positive quantity with at most three decimals.`);
      if (!Number.isFinite(price) || price < 0 || Math.abs(Math.round(price * 100) - price * 100) > 1e-7)
        throw new Error(`Item ${index + 1} needs a nonnegative price with at most two decimals.`);
      return { description: row.description.trim(), quantity, unitPriceCents: Math.round(price * 100) };
    }),
  };
}

export default function BundlesPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Id<"bundles"> | "new" | null>(null);
  const [deleteId, setDeleteId] = useState<Id<"bundles"> | null>(null);
  const [busy, setBusy] = useState(false);
  const { results, status, loadMore } = usePaginatedQuery(api.bundles.listBundles, { search }, { initialNumItems: 20 });
  const duplicate = useMutation(api.bundles.duplicateBundle);
  const remove = useMutation(api.bundles.deleteBundle);

  const duplicateBundle = async (id: Id<"bundles">, name: string) => {
    const suggested = `${name} (copy)`;
    const copyName = window.prompt("Name for the new bundle", suggested)?.trim();
    if (!copyName) return;
    try {
      const copyId = await duplicate({ id, name: copyName });
      setEditing(copyId);
      toast.success("Bundle duplicated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not duplicate bundle.");
    }
  };

  if (editing) return <BundleEditor key={editing} id={editing === "new" ? null : editing} onDone={() => setEditing(null)} />;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/invoice-builder" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-3" /> Invoice Builder</Link>
          <h1 className="text-xl font-semibold tracking-tight">Job Bundles</h1>
          <p className="mt-1 text-xs text-muted-foreground">Reusable work and document sets, priced by your team.</p>
        </div>
        <Button onClick={() => setEditing("new")}><PlusIcon data-icon="inline-start" /> New Bundle</Button>
      </div>
      <label className="mb-5 block max-w-sm space-y-1.5 text-xs font-medium">
        <span>Find a bundle</span>
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search bundles" />
      </label>
      {status === "LoadingFirstPage" && <p className="text-xs text-muted-foreground">Loading bundles…</p>}
      {status !== "LoadingFirstPage" && results.length === 0 && (
        <Card><CardContent className="py-12 text-center">
          <p className="text-sm font-medium">{search ? "No bundles match your search." : "No bundles yet."}</p>
          <p className="mt-1 text-xs text-muted-foreground">{search ? "Try a different name or description." : "Create a reusable set of job items and supporting documents."}</p>
          {!search && <Button className="mt-5" onClick={() => setEditing("new")}>Create Bundle</Button>}
        </CardContent></Card>
      )}
      <div className="grid gap-3">
        {results.map(bundle => (
          <Card key={bundle._id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{bundle.name}</h2>
                {bundle.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{bundle.description}</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">{bundle.itemCount} items · {bundle.documentCount} documents · {formatCurrency(bundle.subtotalCents / 100)} before profit · Updated {new Date(bundle.updatedAt).toLocaleDateString()}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(bundle._id)}>Edit</Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Duplicate ${bundle.name}`} onClick={() => void duplicateBundle(bundle._id, bundle.name)}><CopyIcon className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${bundle.name}`} onClick={() => setDeleteId(bundle._id)}><Trash2Icon className="size-4 text-destructive" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {status === "CanLoadMore" && <Button className="mt-5" variant="outline" onClick={() => loadMore(20)}>Load more</Button>}
      <ConfirmDialog open={deleteId !== null} title="Delete this bundle?" description="Existing invoices and packets will not be changed. This cannot be undone." confirmLabel="Delete" confirming={busy}
        onCancel={() => setDeleteId(null)} onConfirm={() => {
          if (!deleteId) return;
          setBusy(true);
          void remove({ id: deleteId }).then(() => { setDeleteId(null); toast.success("Bundle deleted."); })
            .catch(error => toast.error(error instanceof Error ? error.message : "Could not delete bundle."))
            .finally(() => setBusy(false));
        }} />
    </div>
  );
}

function BundleEditor({ id, onDone }: { id: Id<"bundles"> | null; onDone: () => void }) {
  const router = useRouter();
  const detail = useQuery(api.bundles.getBundle, id ? { id } : "skip");
  const create = useMutation(api.bundles.createBundle);
  const update = useMutation(api.bundles.updateBundle);
  const [form, setForm] = useState<BundleForm>(blankForm);
  const [hydrated, setHydrated] = useState(!id);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!detail || hydrated) return;
    setForm({
      name: detail.name, description: detail.description,
      rows: detail.items.map(item => ({ id: item._id, description: item.description, quantity: String(item.quantity), unitPrice: String(item.unitPriceCents / 100) })),
      documentIds: detail.documents.map(doc => doc.documentId),
    });
    setHydrated(true);
  }, [detail, hydrated]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href?.startsWith("/")) return;
      event.preventDefault(); event.stopPropagation();
      setPendingHref(href); setConfirmLeave(true);
    };
    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [dirty]);

  const change = (next: BundleForm) => { setForm(next); setDirty(true); };
  const patchRow = (rowId: string, patch: Partial<BundleRow>) => change({ ...form, rows: form.rows.map(row => row.id === rowId ? { ...row, ...patch } : row) });
  const move = (index: number, direction: -1 | 1) => {
    const next = [...form.rows]; const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    change({ ...form, rows: next });
  };
  const save = async () => {
    try {
      const content = bundlePayload(form);
      setSaving(true);
      if (id && detail) await update({ id, expectedRevision: detail.revision, ...content });
      else await create(content);
      setDirty(false);
      toast.success(id ? "Bundle updated." : "Bundle created.");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save bundle.");
    } finally { setSaving(false); }
  };

  if (id && detail === null) return <div className="mx-auto max-w-5xl px-4 py-8"><p className="mb-4 text-sm">This bundle is no longer available.</p><Button variant="outline" onClick={onDone}>All Bundles</Button></div>;
  if (!hydrated) return <div className="mx-auto max-w-5xl px-4 py-8 text-xs text-muted-foreground">Loading bundle…</div>;
  const missing = detail?.documents.filter(doc => !doc.available && form.documentIds.includes(doc.documentId)) ?? [];
  const subtotal = form.rows.reduce((sum, row) => sum + Math.round((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0) * 100), 0) / 100;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <button type="button" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => dirty ? setConfirmLeave(true) : onDone()}><ArrowLeftIcon className="size-3" /> All Bundles</button>
      <div className="mb-6"><h1 className="text-xl font-semibold">{id ? "Edit Bundle" : "New Bundle"}</h1><p className="mt-1 text-xs text-muted-foreground">Set your defaults here. Applying a bundle copies them into an invoice.</p></div>
      <div className="space-y-5">
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="bundle-name">Name</Label><Input id="bundle-name" maxLength={100} value={form.name} onChange={e => change({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="bundle-description">Internal description</Label><Textarea id="bundle-description" maxLength={1000} value={form.description} onChange={e => change({ ...form, description: e.target.value })} /></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Work items</CardTitle></CardHeader><CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">List work in construction order. Invoice profit is added separately.</p>
          {form.rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_72px_100px_auto] items-end gap-2 rounded-md border p-3">
              <label className="space-y-1 text-xs">Description<Input aria-label={`Item ${index + 1} description`} maxLength={500} value={row.description} onChange={e => patchRow(row.id, { description: e.target.value })} /></label>
              <label className="space-y-1 text-xs">Qty<Input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="0.001" value={row.quantity} onChange={e => patchRow(row.id, { quantity: e.target.value })} /></label>
              <label className="space-y-1 text-xs">Unit price<Input aria-label={`Item ${index + 1} unit price`} type="number" min="0" step="0.01" value={row.unitPrice} onChange={e => patchRow(row.id, { unitPrice: e.target.value })} /></label>
              <div className="flex items-center">
                <Button size="icon-sm" variant="ghost" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpIcon className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Move item ${index + 1} down`} disabled={index === form.rows.length - 1} onClick={() => move(index, 1)}><ArrowDownIcon className="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove item ${index + 1}`} disabled={form.rows.length === 1} onClick={() => change({ ...form, rows: form.rows.filter(item => item.id !== row.id) })}><Trash2Icon className="size-4" /></Button>
              </div>
              <p className="col-span-full text-right text-xs text-muted-foreground">Amount {formatCurrency(Math.round((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0) * 100) / 100)}</p>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={form.rows.length >= 100} onClick={() => change({ ...form, rows: [...form.rows, blankRow()] })}><PlusIcon data-icon="inline-start" /> Add Item</Button>
          <p className="border-t pt-3 text-right text-sm font-semibold">Before profit: {formatCurrency(subtotal)}</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Supporting documents</CardTitle></CardHeader><CardContent><BundleDocuments selected={form.documentIds} onChange={documentIds => change({ ...form, documentIds })} missing={missing} /></CardContent></Card>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => dirty ? setConfirmLeave(true) : onDone()}>Cancel</Button><Button disabled={saving || missing.length > 0} onClick={() => void save()}>{saving ? "Saving…" : "Save Bundle"}</Button></div>
      </div>
      <ConfirmDialog open={confirmLeave} title="Discard bundle changes?" description="Your unsaved changes will be lost." confirmLabel="Discard" onConfirm={() => { setDirty(false); setConfirmLeave(false); if (pendingHref) router.push(pendingHref as Parameters<typeof router.push>[0]); else onDone(); }} onCancel={() => { setConfirmLeave(false); setPendingHref(null); }} />
    </div>
  );
}
