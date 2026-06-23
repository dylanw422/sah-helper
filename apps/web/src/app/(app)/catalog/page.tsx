"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  BookOpenIcon,
  Loader2Icon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/format";

type CatalogItem = Doc<"catalogItems">;

function EditDialog({
  item,
  onClose,
}: {
  item: CatalogItem;
  onClose: () => void;
}) {
  const updateItem = useMutation(api.catalog.updateItem);
  const [description, setDescription] = useState(item.canonicalDescription);
  const [unit, setUnit] = useState(item.unit ?? "");
  const [manualPrice, setManualPrice] = useState(
    item.manualUnitPrice != null ? String(item.manualUnitPrice) : "",
  );
  const [priceLocked, setPriceLocked] = useState(item.priceLocked ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!description.trim()) return;
    setSaving(true);
    try {
      const parsedPrice = parseFloat(manualPrice);
      await updateItem({
        id: item._id,
        canonicalDescription: description.trim(),
        unit,
        manualUnitPrice: priceLocked && !isNaN(parsedPrice) ? parsedPrice : null,
        priceLocked: priceLocked && !isNaN(parsedPrice),
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-md border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">Edit Catalog Item</h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Input
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-unit">Unit (optional)</Label>
            <Input
              id="edit-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="each, sq ft, linear ft, lump sum…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-price">
              Manual Price (overrides AI generation)
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                $
              </span>
              <Input
                id="edit-price"
                type="number"
                inputMode="decimal"
                value={manualPrice}
                onChange={(e) => {
                  setManualPrice(e.target.value);
                  setPriceLocked(e.target.value.trim() !== "");
                }}
                placeholder="Leave blank to use learned price"
                className="pl-5"
              />
            </div>
            {priceLocked && manualPrice && (
              <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                <LockIcon className="size-3" />
                This price will be used for AI invoice generation.
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !description.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type ImportPhase = "pick" | "extracting" | "preview" | "importing";

type PreviewLine = {
  key: string;
  description: string;
  qty: number;
  unitPrice: number;
};

function ImportDialog({ onClose }: { onClose: () => void }) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const doImport = useAction(api.catalog.importFromPdf);
  const confirmImport = useMutation(api.catalog.confirmImport);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<ImportPhase>("pick");
  const [dragOver, setDragOver] = useState(false);
  const [storedId, setStoredId] = useState<Id<"_storage"> | null>(null);
  const [fileName, setFileName] = useState("");
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [extractedTotal, setExtractedTotal] = useState(0);
  const [mismatchWarning, setMismatchWarning] = useState(false);

  const handleFile = async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please select a PDF file.");
      return;
    }
    setPhase("extracting");
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId: sid } = (await res.json()) as { storageId: Id<"_storage"> };
      const preview = await doImport({ storageId: sid, fileName: file.name });
      setStoredId(sid);
      setFileName(file.name);
      setExtractedTotal(preview.total);
      setMismatchWarning(preview.totalMismatchWarning);
      setLines(
        preview.lineItems.map((item) => ({
          key: crypto.randomUUID(),
          description: item.description,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })),
      );
      setPhase("preview");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read invoice.");
      setPhase("pick");
    }
  };

  const handleConfirm = async () => {
    if (!storedId) return;
    setPhase("importing");
    try {
      await confirmImport({
        storageId: storedId,
        fileName,
        lineItems: lines.map(({ description, qty, unitPrice }) => ({ description, qty, unitPrice })),
      });
      toast.success(
        `Imported ${lines.length} item${lines.length === 1 ? "" : "s"} from ${fileName}.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import items.");
      setPhase("preview");
    }
  };

  const updateLine = (key: string, field: "description" | "qty" | "unitPrice", raw: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        if (field === "description") return { ...l, description: raw };
        const num = parseFloat(raw);
        return { ...l, [field]: isNaN(num) ? l[field] : num };
      }),
    );
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const canClose = phase === "pick" || phase === "preview";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={canClose ? onClose : undefined}
    >
      <div
        className="flex w-full max-w-xl flex-col rounded-md border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Import from Invoice PDF</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Line items and prices will be added to your pricing catalog.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {(phase === "pick" || phase === "extracting") && (
            <div>
              <button
                type="button"
                disabled={phase === "extracting"}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) void handleFile(file);
                }}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-xs transition-colors ${
                  dragOver
                    ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                    : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                }`}
              >
                {phase === "extracting" ? (
                  <>
                    <Loader2Icon className="size-5 animate-spin text-indigo-500" />
                    <span>Reading invoice…</span>
                  </>
                ) : (
                  <>
                    <UploadCloudIcon className="size-5" />
                    <span>Drop a PDF here, or click to browse</span>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {(phase === "preview" || phase === "importing") && (
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <p className="truncate text-xs font-medium">{fileName}</p>
                <p className="ml-4 shrink-0 text-xs text-muted-foreground">
                  {lines.length} item{lines.length === 1 ? "" : "s"}
                </p>
              </div>

              {mismatchWarning && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                  Line items don't sum to the invoice total — double-check prices before importing.
                </div>
              )}

              {lines.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                  No line items found in this PDF.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                  <div className="grid grid-cols-[minmax(0,1fr)_60px_88px_28px] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span>Description</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Unit price</span>
                    <span />
                  </div>
                  <div className="divide-y divide-border">
                    {lines.map((line) => (
                      <div
                        key={line.key}
                        className="grid grid-cols-[minmax(0,1fr)_60px_88px_28px] items-center gap-2 px-3 py-1.5"
                      >
                        <input
                          className="h-6 w-full rounded border border-transparent bg-transparent px-1 text-xs focus:border-ring focus:outline-none"
                          value={line.description}
                          onChange={(e) => updateLine(line.key, "description", e.target.value)}
                        />
                        <input
                          type="number"
                          step="any"
                          min="0"
                          className="h-6 w-full rounded border border-transparent bg-transparent px-1 text-right text-xs tabular-nums focus:border-ring focus:outline-none"
                          value={line.qty}
                          onChange={(e) => updateLine(line.key, "qty", e.target.value)}
                        />
                        <div className="relative">
                          <span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[10px] text-muted-foreground">$</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            className="h-6 w-full rounded border border-transparent bg-transparent pl-4 pr-1 text-right text-xs tabular-nums focus:border-ring focus:outline-none"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(line.key, "unitPrice", e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Remove"
                        >
                          <Trash2Icon className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={!canClose}>
            Cancel
          </Button>
          {(phase === "preview" || phase === "importing") && (
            <Button
              size="sm"
              onClick={() => void handleConfirm()}
              disabled={phase === "importing" || lines.length === 0}
            >
              {phase === "importing" ? (
                <><Loader2Icon className="mr-1.5 size-3.5 animate-spin" />Importing…</>
              ) : (
                `Add ${lines.length} item${lines.length === 1 ? "" : "s"} to Catalog`
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CatalogPage() {
  const items = useQuery(api.catalog.listItems);
  const deleteItem = useMutation(api.catalog.deleteItem);
  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = (items ?? []).filter(
    (item) =>
      !search.trim() ||
      item.canonicalDescription.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteItem({ id: pendingDelete._id });
      setPendingDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete item.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.025em]">Pricing Catalog</h1>
          {items !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {items.length} {items.length === 1 ? "item" : "items"} learned from your invoices
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => setImportOpen(true)}>
            <UploadCloudIcon data-icon="inline-start" />
            Import from PDF
          </Button>
          <Link
            href="/invoice-builder"
            className={buttonVariants({ size: "lg" })}
          >
            <PlusIcon data-icon="inline-start" />
            New Invoice
          </Link>
        </div>
      </div>

      {items === undefined ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-md border border-dashed border-border py-20 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400">
            <BookOpenIcon className="size-7" />
          </div>
          <p className="mb-1 text-sm font-medium">Your pricing catalog is empty</p>
          <p className="mb-5 max-w-xs text-xs text-muted-foreground">
            It fills in automatically as you save invoices, or you can{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => setImportOpen(true)}
            >
              import an existing invoice PDF
            </button>
            .
          </p>
          <Link href="/invoice-builder" className={buttonVariants({})}>
            <PlusIcon data-icon="inline-start" />
            Build your first invoice
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="h-9 w-full rounded-md border border-border bg-card pr-3 pl-9 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
              No items match &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border bg-card">
              <div className="grid grid-cols-[minmax(0,1fr)_80px_96px_96px_60px_72px] items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <span>Item</span>
                <span>Unit</span>
                <span className="text-right">Avg price</span>
                <span className="text-right">Last price</span>
                <span className="text-right">Used</span>
                <span />
              </div>
              <div className="divide-y divide-border">
                {filtered.map((item) => (
                  <CatalogRow
                    key={item._id}
                    item={item}
                    onEdit={() => setEditingItem(item)}
                    onDelete={() => setPendingDelete(item)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}

      {editingItem && (
        <EditDialog item={editingItem} onClose={() => setEditingItem(null)} />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.canonicalDescription ?? ""}"?`}
        description="This item and all its price history will be permanently removed from the catalog."
        confirmLabel="Delete"
        confirming={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function CatalogRow({
  item,
  onEdit,
  onDelete,
}: {
  item: CatalogItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const priceRange =
    item.minUnitPrice !== item.maxUnitPrice
      ? `${formatCurrency(item.minUnitPrice)} – ${formatCurrency(item.maxUnitPrice)}`
      : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_80px_96px_96px_60px_72px] items-center gap-2 px-4 py-3 text-xs hover:bg-muted/30">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{item.canonicalDescription}</span>
          {item.priceLocked && (
            <LockIcon className="size-3 shrink-0 text-amber-500" aria-label="Manual price locked" />
          )}
        </div>
        {priceRange && (
          <span className="text-[10px] text-muted-foreground/60">{priceRange}</span>
        )}
      </div>
      <span className="truncate text-muted-foreground">{item.unit ?? "—"}</span>
      <span className="text-right font-mono tabular-nums">
        {formatCurrency(item.avgUnitPrice)}
      </span>
      <span className="text-right font-mono tabular-nums">
        {item.priceLocked && item.manualUnitPrice != null ? (
          <span className="text-amber-600 dark:text-amber-400">
            {formatCurrency(item.manualUnitPrice)}
          </span>
        ) : (
          formatCurrency(item.lastUnitPrice)
        )}
      </span>
      <span className="text-right font-mono tabular-nums text-muted-foreground">
        {item.occurrences}×
      </span>
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit">
          <PencilIcon className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete">
          <Trash2Icon className="size-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
