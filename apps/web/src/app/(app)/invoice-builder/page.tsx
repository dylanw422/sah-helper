"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useAction, useQuery } from "convex/react";
import { ArrowRightIcon, BuildingIcon, DownloadIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  createLineItemRow,
  LineItemsEditor,
  lineItemRowAmount,
  type LineItemRow,
} from "@/components/invoice/line-items-editor";
import type { VerifiedData } from "@/components/wizard/verify-step";
import { downloadFile } from "@/lib/download";
import { formatCurrency } from "@/lib/format";
import { writeInvoiceDraft } from "@/lib/invoice-draft";

type BuiltInvoice = { storageId: Id<"_storage">; url: string };

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDisplayDate(inputValue: string): string {
  const date = new Date(`${inputValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return inputValue;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

const CLIENT_FIELDS = [
  { key: "name", label: "Client Name" },
  { key: "street", label: "Street Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip Code" },
  { key: "phone", label: "Phone Number" },
] as const;

export default function InvoiceBuilderPage() {
  const router = useRouter();
  const settings = useQuery(api.settings.getSettings);
  const suggestedNumber = useQuery(api.invoiceBuilder.suggestInvoiceNumber);
  const buildInvoice = useAction(api.invoiceBuilder.buildInvoice);

  const [fields, setFields] = useState({
    name: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    invoiceNumber: "",
    caseNumber: "",
  });
  const [invoiceDate, setInvoiceDate] = useState(todayInputValue);
  const [rows, setRows] = useState<LineItemRow[]>(() => [createLineItemRow()]);
  const [numberHydrated, setNumberHydrated] = useState(false);
  // Cached build result; cleared whenever any form field changes so the next
  // action builds a fresh PDF.
  const [built, setBuilt] = useState<BuiltInvoice | null>(null);
  const [pending, setPending] = useState<"download" | "start" | null>(null);

  useEffect(() => {
    if (suggestedNumber !== undefined && !numberHydrated) {
      setFields((f) => (f.invoiceNumber === "" ? { ...f, invoiceNumber: suggestedNumber } : f));
      setNumberHydrated(true);
    }
  }, [suggestedNumber, numberHydrated]);

  const setField = (key: keyof typeof fields, value: string) => {
    setBuilt(null);
    setFields((f) => ({ ...f, [key]: value }));
  };

  const handleRowsChange = (next: LineItemRow[]) => {
    setBuilt(null);
    setRows(next);
  };

  const total = rows.reduce((sum, row) => sum + lineItemRowAmount(row), 0);
  const holdback = total * 0.2;

  const canBuild =
    fields.name.trim() !== "" &&
    fields.street.trim() !== "" &&
    fields.caseNumber.trim() !== "" &&
    rows.length > 0 &&
    rows.some((row) => row.description.trim() !== "");

  const toVerifiedData = (): VerifiedData => ({
    name: fields.name,
    street: fields.street,
    city: fields.city,
    state: fields.state,
    zip: fields.zip,
    phone: fields.phone,
    invoiceNumber: fields.invoiceNumber,
    caseNumber: fields.caseNumber.trim(),
    lineItems: rows
      .filter((row) => row.description.trim() !== "" || lineItemRowAmount(row) > 0)
      .map((row) => ({
        description: row.description,
        qty: parseFloat(row.qty) || 0,
        unitPrice: parseFloat(row.unitPrice) || 0,
        amount: lineItemRowAmount(row),
      })),
  });

  const ensureBuilt = async (): Promise<BuiltInvoice> => {
    if (built) return built;
    const data = toVerifiedData();
    const result = await buildInvoice({
      ...data,
      invoiceDate: formatDisplayDate(invoiceDate),
    });
    setBuilt(result);
    return result;
  };

  const handleDownload = async () => {
    if (pending) return;
    setPending("download");
    try {
      const { url } = await ensureBuilt();
      await downloadFile(url, "Invoice.pdf");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the invoice.");
    } finally {
      setPending(null);
    }
  };

  const handleStartPacket = async () => {
    if (pending) return;
    setPending("start");
    try {
      const { storageId } = await ensureBuilt();
      writeInvoiceDraft({ invoiceStorageId: storageId, data: toVerifiedData() });
      router.push("/new-packet");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the invoice.");
      setPending(null);
    }
  };

  if (settings === undefined) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-8 h-3 w-72" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (settings === null) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 pt-24 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400">
          <SettingsIcon className="size-6" />
        </div>
        <h1 className="mb-2 text-lg font-semibold">Contractor settings are not configured</h1>
        <p className="mb-6 text-xs text-muted-foreground">
          Visit Settings before building invoices. Your contractor information fills the
          &ldquo;From&rdquo; section of every invoice.
        </p>
        <Link href="/settings" className={buttonVariants({})}>
          Go to Settings
        </Link>
      </div>
    );
  }

  const itemCount = rows.filter(
    (row) => row.description.trim() !== "" || lineItemRowAmount(row) > 0,
  ).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">Invoice Builder</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Compose a new invoice. Drag line items to set construction order.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BuildingIcon className="size-4 text-muted-foreground" />
                From (Contractor)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0.5 text-xs">
                <p className="text-sm font-medium">{settings.contractorCompanyName}</p>
                <p className="text-muted-foreground">
                  {settings.contractorName}
                  {settings.contractorLicense && ` · License #${settings.contractorLicense}`}
                </p>
                <p className="text-muted-foreground">
                  {settings.contractorStreet}, {settings.contractorCity},{" "}
                  {settings.contractorState} {settings.contractorZip}
                </p>
                <p className="text-muted-foreground">
                  {settings.contractorPhone} · {settings.contractorEmail}
                </p>
              </div>
              <Link
                href="/settings"
                className="mt-3 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Edit in Settings →
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bill To (Client)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {CLIENT_FIELDS.map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`field-${key}`}>{label}</Label>
                    <Input
                      id={`field-${key}`}
                      value={fields[key]}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="field-invoiceNumber">Invoice Number</Label>
                  <Input
                    id="field-invoiceNumber"
                    value={fields.invoiceNumber}
                    onChange={(e) => setField("invoiceNumber", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field-invoiceDate">Invoice Date</Label>
                  <Input
                    id="field-invoiceDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => {
                      setBuilt(null);
                      setInvoiceDate(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="field-caseNumber">SAH Case Number (required)</Label>
                  <Input
                    id="field-caseNumber"
                    value={fields.caseNumber}
                    onChange={(e) => setField("caseNumber", e.target.value)}
                    aria-invalid={fields.caseNumber.trim() === ""}
                    placeholder="Identification number from the invoice"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <LineItemsEditor rows={rows} onChange={handleRowsChange} />
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Invoice #</dt>
                  <dd className="truncate font-mono">{fields.invoiceNumber || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Date</dt>
                  <dd>{formatDisplayDate(invoiceDate)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="font-mono tabular-nums">{itemCount}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(total)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Holdback (20%)</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(holdback)}</dd>
                </div>
                <div className="flex justify-between gap-2 border-t pt-2 text-sm font-semibold">
                  <dt>Total</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(total)}</dd>
                </div>
              </dl>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  disabled={!canBuild || pending !== null}
                  onClick={handleDownload}
                >
                  <DownloadIcon data-icon="inline-start" />
                  {pending === "download" ? "Building..." : "Download Invoice"}
                </Button>
                <Button disabled={!canBuild || pending !== null} onClick={handleStartPacket}>
                  {pending === "start" ? "Building..." : "Start Packet"}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
