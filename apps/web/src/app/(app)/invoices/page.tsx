"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRightIcon,
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { downloadFile } from "@/lib/download";
import { formatCurrency, formatDate, formatDisplayDate } from "@/lib/format";
import { fadeUp, stagger } from "@/lib/motion";

export default function SavedInvoicesPage() {
  const invoices = useQuery(api.invoiceBuilder.listInvoices);
  const buildInvoice = useAction(api.invoiceBuilder.buildInvoice);
  const deleteInvoice = useMutation(api.invoiceBuilder.deleteInvoice);
  const router = useRouter();
  const [downloadingId, setDownloadingId] = useState<Id<"invoices"> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Doc<"invoices"> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  const search = searchInput.trim().toLowerCase();
  const filteredInvoices = (invoices ?? []).filter((invoice) =>
    !search ||
    [
      invoice.invoiceNumber,
      invoice.name,
      invoice.caseNumber,
      invoice.street,
      invoice.city,
      invoice.state,
      invoice.zip,
      `${invoice.street}, ${invoice.city}, ${invoice.state} ${invoice.zip}`,
    ].some((value) => value.toLowerCase().includes(search)),
  );
  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteInvoice({ id: pendingDelete._id });
      setPendingDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the invoice.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async (invoice: Doc<"invoices">) => {
    if (downloadingId) return;
    setDownloadingId(invoice._id);
    try {
      const { url } = await buildInvoice({
        name: invoice.name,
        street: invoice.street,
        city: invoice.city,
        state: invoice.state,
        zip: invoice.zip,
        phone: invoice.phone,
        invoiceNumber: invoice.invoiceNumber,
        caseNumber: invoice.caseNumber,
        invoiceDate: formatDisplayDate(invoice.invoiceDate),
        lineItems: invoice.lineItems,
      });
      await downloadFile(url, "Invoice.pdf");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the invoice.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:pt-10">
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-indigo-600 uppercase dark:text-indigo-400">
            Workspace overview
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[34px]">Invoices</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Build invoices and prepare them for client packets.
          </p>
        </div>
        <Link
          href="/invoice-builder"
          className="group inline-flex min-h-12 w-full items-center gap-3 rounded-lg border border-indigo-400/30 bg-primary px-3 py-2 text-primary-foreground shadow-[0_8px_24px_-12px_rgb(79_70_229/0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgb(79_70_229/0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 sm:w-auto"
        >
          <span className="flex size-8 items-center justify-center rounded-md border border-white/15 bg-white/15">
            <PlusIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="flex flex-1 flex-col leading-tight sm:flex-none">
            <span className="text-sm font-semibold tracking-[-0.015em]">New invoice</span>
            <span className="text-[10px] text-white/75">Start from scratch</span>
          </span>
          <ArrowUpRightIcon className="ml-3 size-4 text-white/75 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em]">Invoice directory</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {invoices === undefined ? "Loading invoices" : `Showing ${filteredInvoices.length} of ${invoices.length} invoices`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search invoices"
            aria-label="Search invoices by client name, address, case number, or invoice number"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-10 rounded-lg bg-card pl-10"
          />
        </div>
      </div>

      {invoices === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <InvoiceRowSkeleton key={i} />)}
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/60 px-5 py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-lg bg-accent text-indigo-600 dark:text-indigo-400">
            <FileTextIcon className="size-7" />
          </div>
          <p className="mb-1 text-base font-semibold">No saved invoices yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">Create your first invoice to get started.</p>
          <Link href="/invoice-builder" className={buttonVariants({ variant: "outline", className: "mt-5" })}>
            New invoice <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/60 px-5 py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-lg bg-accent text-indigo-600 dark:text-indigo-400">
            <SearchIcon className="size-7" />
          </div>
          <p className="mb-1 text-base font-semibold">No invoices match your search</p>
          <p className="mb-5 text-xs text-muted-foreground">Try a different name, address, case number, or invoice number.</p>
          <Button variant="outline" onClick={() => setSearchInput("")}>Clear search</Button>
        </div>
      ) : (
        <motion.div variants={stagger()} initial="hidden" animate="visible" className="space-y-3">
          {filteredInvoices.map((invoice) => (
            <motion.div
              key={invoice._id}
              variants={fadeUp}
              className="rounded-lg border border-border bg-card transition-colors duration-200 hover:border-foreground/20 hover:bg-surface-overlay focus-within:border-foreground/20"
            >
              <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400">
                    <FileTextIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em]">{invoice.name || "Unnamed client"}</p>
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">#{invoice.invoiceNumber || "—"}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{invoice.street}, {invoice.city}, {invoice.state} {invoice.zip}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{invoice.caseNumber ? `Case ${invoice.caseNumber} · ` : ""}{invoice.lineItems.length} {invoice.lineItems.length === 1 ? "item" : "items"}</p>
                    <p className="mt-1.5 font-mono text-xs font-medium tabular-nums sm:hidden">{formatCurrency(invoice.total)} <span className="font-sans font-normal text-muted-foreground">· Updated {formatDate(invoice.updatedAt)}</span></p>
                  </div>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <p className="font-mono text-[14px] font-semibold tabular-nums">{formatCurrency(invoice.total)}</p>
                  <p className="text-[11px] text-muted-foreground">Updated {formatDate(invoice.updatedAt)}</p>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border pt-3 sm:border-0 sm:pt-0">
                  <Button
                    variant="outline"
                    size="icon-lg"
                    className="rounded-md"
                    aria-label={`${downloadingId === invoice._id ? "Building" : "Download"} invoice ${invoice.invoiceNumber}`}
                    disabled={downloadingId !== null}
                    onClick={() => void handleDownload(invoice)}
                  >
                    {downloadingId === invoice._id ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-9 rounded-md border-indigo-500/20 bg-indigo-500/10 px-3 text-indigo-700 hover:bg-indigo-500/15 dark:text-indigo-300"
                    aria-label={`Generate packet from invoice ${invoice.invoiceNumber}`}
                    onClick={() => router.push(`/invoice-builder?id=${invoice._id}`)}
                  >
                    <FileTextIcon className="size-4" />
                    Generate
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-lg"
                    className="rounded-md"
                    aria-label={`Delete invoice ${invoice.invoiceNumber}`}
                    onClick={() => setPendingDelete(invoice)}
                  >
                    <Trash2Icon className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete invoice ${pendingDelete?.invoiceNumber ?? ""}?`}
        description="This invoice will be permanently deleted and cannot be recovered."
        confirmLabel="Delete"
        confirming={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function InvoiceRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
      <div className="skeleton-shimmer size-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton-shimmer h-4 w-48 max-w-full rounded-sm" />
        <div className="skeleton-shimmer h-3 w-64 max-w-full rounded-sm" />
      </div>
      <div className="hidden space-y-2 sm:block">
        <div className="skeleton-shimmer h-4 w-24 rounded-sm" />
        <div className="skeleton-shimmer h-3 w-20 rounded-sm" />
      </div>
    </div>
  );
}
