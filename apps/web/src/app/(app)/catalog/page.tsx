"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useMutation, useQuery } from "convex/react";
import {
  BookOpenIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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

export default function CatalogPage() {
  const items = useQuery(api.catalog.listItems);
  const deleteItem = useMutation(api.catalog.deleteItem);
  const triggerBackfill = useMutation(api.catalog.triggerBackfill);
  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

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

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await triggerBackfill();
      toast.success("Pricing catalog rebuilt from all invoices and clients.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rebuild catalog.");
    } finally {
      setRebuilding(false);
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
          <Button
            variant="outline"
            size="lg"
            disabled={rebuilding}
            onClick={() => void handleRebuild()}
          >
            {rebuilding ? "Rebuilding…" : "Rebuild from invoices"}
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
          <p className="mb-5 text-xs text-muted-foreground">
            It fills in automatically as you save invoices.
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
