"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useAction, useQuery } from "convex/react";
import { DownloadIcon, FileTextIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { downloadFile } from "@/lib/download";
import { formatCurrency, formatDate, formatDisplayDate } from "@/lib/format";

export default function SavedInvoicesPage() {
  const invoices = useQuery(api.invoiceBuilder.listInvoices);
  const buildInvoice = useAction(api.invoiceBuilder.buildInvoice);
  const router = useRouter();
  const [downloadingId, setDownloadingId] = useState<Id<"invoices"> | null>(null);

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
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-[-0.025em]">Saved Invoices</h1>
        <Link href="/invoice-builder" className={buttonVariants({ size: "lg" })}>
          <PlusIcon data-icon="inline-start" />
          New Invoice
        </Link>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        All invoices you&rsquo;ve saved from the Invoice Builder.
      </p>

      {invoices === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-20 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400">
            <FileTextIcon className="size-7" />
          </div>
          <p className="mb-1 text-sm font-medium">No saved invoices yet</p>
          <p className="mb-5 text-xs text-muted-foreground">Build one to get started.</p>
          <Link href="/invoice-builder" className={buttonVariants({})}>
            <PlusIcon data-icon="inline-start" />
            New Invoice
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          {invoices.map((invoice) => (
            <div key={invoice._id} className="flex items-center gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 truncate text-[14px] font-semibold">
                  <span className="font-mono">{invoice.invoiceNumber || "—"}</span>
                  {invoice.name && <span className="font-normal"> · {invoice.name}</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground/70">
                  {formatCurrency(invoice.total)} · {invoice.lineItems.length}{" "}
                  {invoice.lineItems.length === 1 ? "item" : "items"} · Updated{" "}
                  {formatDate(invoice.updatedAt)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Download ${invoice.invoiceNumber}`}
                disabled={downloadingId !== null}
                onClick={() => void handleDownload(invoice)}
              >
                <DownloadIcon className="size-3.5" />
                <span className="hidden sm:inline">
                  {downloadingId === invoice._id ? "Building..." : "Download"}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/invoice-builder?id=${invoice._id}`)}
              >
                <PencilIcon className="size-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
