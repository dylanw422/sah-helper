"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BuildingIcon,
  DownloadIcon,
  FileTextIcon,
  FilesIcon,
  ListChecksIcon,
  SettingsIcon,
  PlusIcon,
  UserRoundIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { BundlePicker } from "@/components/invoice/bundle-picker";
import { SaveAsBundle } from "@/components/invoice/save-as-bundle";
import {
  createLineItemRow,
  createProfitRow,
  LineItemsEditor,
  lineItemRowAmount,
  PROFIT_DESCRIPTION,
  type LineItemRow,
} from "@/components/invoice/line-items-editor";
import type { VerifiedData } from "@/components/wizard/verify-step";
import { downloadFile } from "@/lib/download";
import { formatCurrency, formatDisplayDate, maskPhone } from "@/lib/format";
import { grantBand, MAX_GRANT_AMOUNT, targetInvoiceAmount } from "@/lib/grant";
import { consumeInvoiceRevisionDraft, writeInvoiceDraft } from "@/lib/invoice-draft";
import { useWorkspaceId } from "@/components/workspace-context";

type BuiltInvoice = { storageId: Id<"_storage">; url: string };

type PendingNav = { kind: "link"; href: string } | { kind: "startPacket" };

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function savedLineItemsToRows(items: VerifiedData["lineItems"]): LineItemRow[] {
  const rows: LineItemRow[] = items.map((item, index) => ({
    id: crypto.randomUUID(),
    description: index === items.length - 1 && /profit/i.test(item.description)
      ? PROFIT_DESCRIPTION
      : item.description,
    qty: String(item.qty),
    unitPrice: String(item.unitPrice),
  }));
  if (rows[rows.length - 1]?.description !== PROFIT_DESCRIPTION) {
    rows.push({ ...createProfitRow(), qty: "0" });
  }
  if (rows.length === 1) rows.unshift(createLineItemRow());
  return rows;
}

const CLIENT_FIELDS = [
  { key: "name", label: "Client Name" },
  { key: "street", label: "Street Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "Zip Code" },
  { key: "phone", label: "Phone Number" },
] as const;

const SECTION_CARD_CLASS = "gap-0 rounded-lg py-0";
const SECTION_HEADER_CLASS = "border-b border-border px-5 py-4";
const SECTION_CONTENT_CLASS = "px-5 py-5";

function BuilderSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:pt-10">
      <Skeleton className="mb-3 h-3 w-32" />
      <Skeleton className="mb-2 h-9 w-56" />
      <Skeleton className="mb-8 h-4 w-80 max-w-full" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function InvoiceBuilderPage() {
  return (
    <Suspense fallback={<BuilderSkeleton />}>
      <InvoiceBuilder />
    </Suspense>
  );
}

function InvoiceBuilder() {
  const router = useRouter();
  const idParam = useSearchParams().get("id");
  const invoiceId = (idParam as Id<"invoices"> | null) ?? null;
  const settings = useQuery(api.settings.getSettings);
  const maximumInvoiceAmount = settings?.maximumInvoiceAmount ?? MAX_GRANT_AMOUNT;
  const minimumTargetAmount = targetInvoiceAmount(maximumInvoiceAmount);
  const workspaceId = useWorkspaceId();
  const suggestedNumber = useQuery(
    api.invoiceBuilder.suggestInvoiceNumber,
    invoiceId ? "skip" : {},
  );
  const saved = useQuery(api.invoiceBuilder.getInvoice, invoiceId ? { id: invoiceId } : "skip");
  const buildInvoice = useAction(api.invoiceBuilder.buildInvoice);
  const saveInvoice = useMutation(api.invoiceBuilder.saveInvoice);

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
  const [rows, setRows] = useState<LineItemRow[]>(() => [createLineItemRow(), createProfitRow()]);
  const [revisionDocuments, setRevisionDocuments] = useState<Pick<VerifiedData,
    "waiverIds" | "specSheetIds" | "jobSpecificIds"
  >>({});
  const [numberHydrated, setNumberHydrated] = useState(false);
  // Cached build result; cleared whenever any form field changes so the next
  // action builds a fresh PDF.
  const [built, setBuilt] = useState<BuiltInvoice | null>(null);
  const [pending, setPending] = useState<"download" | "start" | null>(null);
  // Tracks whether the form differs from the last-saved (or freshly loaded) state.
  const [dirty, setDirty] = useState(false);
  const [savedHydrated, setSavedHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  const [bundlePickerOpen, setBundlePickerOpen] = useState(false);
  const [saveBundleOpen, setSaveBundleOpen] = useState(false);
  const [appliedBundleIds, setAppliedBundleIds] = useState<Id<"bundles">[]>([]);
  // Incremented on every edit; a save only clears `dirty` if no edits landed
  // while the save request was in flight.
  const editVersion = useRef(0);
  const persistedInvoiceId = useRef<Id<"invoices"> | null>(invoiceId);
  const [autoSaveQueued, setAutoSaveQueued] = useState(false);

  // While the form has unsaved changes, intercept clicks on internal links
  // (including the app header) and confirm before navigating away.
  useEffect(() => {
    if (!dirty) return;
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNav({ kind: "link", href });
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [dirty]);

  useEffect(() => {
    if (suggestedNumber !== undefined && !numberHydrated) {
      setFields((f) => (f.invoiceNumber === "" ? { ...f, invoiceNumber: suggestedNumber } : f));
      setNumberHydrated(true);
    }
  }, [suggestedNumber, numberHydrated]);

  useEffect(() => {
    if (invoiceId) return;
    const revision = consumeInvoiceRevisionDraft(workspaceId);
    if (!revision) return;
    const { data } = revision;
    setFields({
      name: data.name,
      street: data.street,
      city: data.city,
      state: data.state,
      zip: data.zip,
      phone: data.phone,
      invoiceNumber: data.invoiceNumber,
      caseNumber: data.caseNumber,
    });
    if (revision.invoiceDate) setInvoiceDate(revision.invoiceDate);
    setRows(savedLineItemsToRows(data.lineItems));
    setRevisionDocuments({
      waiverIds: data.waiverIds,
      specSheetIds: data.specSheetIds,
      jobSpecificIds: data.jobSpecificIds,
    });
    editVersion.current += 1;
    setDirty(true);
  }, [invoiceId, workspaceId]);

  useEffect(() => {
    if (!invoiceId || savedHydrated) return;
    if (saved === null) {
      toast.error("That invoice no longer exists.");
      router.replace("/invoice-builder");
      return;
    }
    if (saved === undefined) return;
    const revision = consumeInvoiceRevisionDraft(workspaceId, invoiceId);
    const data = revision?.data ?? saved;
    setFields({
      name: data.name,
      street: data.street,
      city: data.city,
      state: data.state,
      zip: data.zip,
      phone: data.phone,
      invoiceNumber: data.invoiceNumber,
      caseNumber: data.caseNumber,
    });
    setInvoiceDate(revision?.invoiceDate ?? saved.invoiceDate);
    setRows(savedLineItemsToRows(data.lineItems));
    setRevisionDocuments({
      waiverIds: data.waiverIds ?? [],
      specSheetIds: data.specSheetIds ?? [],
      jobSpecificIds: data.jobSpecificIds ?? [],
    });
    if (revision) editVersion.current += 1;
    setDirty(Boolean(revision));
    setSavedHydrated(true);
  }, [invoiceId, saved, savedHydrated, router, workspaceId]);

  const markChanged = () => {
    editVersion.current += 1;
    setBuilt(null);
    setDirty(true);
  };

  const setField = (key: keyof typeof fields, value: string) => {
    markChanged();
    setFields((f) => ({ ...f, [key]: value }));
  };

  const handleRowsChange = (next: LineItemRow[]) => {
    markChanged();
    setRows(next);
  };

  const regularRows = rows.slice(0, -1);
  const profitRow = rows[rows.length - 1]!;
  const regularSubtotal = regularRows.reduce((sum, row) => sum + lineItemRowAmount(row), 0);
  const profitPct = parseFloat(profitRow.qty) || 0;
  const profitAmount = Math.round(regularSubtotal * profitPct) / 100;
  const total = regularSubtotal + profitAmount;

  const canBuild =
    fields.name.trim() !== "" &&
    fields.street.trim() !== "" &&
    fields.caseNumber.trim() !== "" &&
    regularRows.some((row) => row.description.trim() !== "");

  const toVerifiedData = (): VerifiedData => {
    const regularRows = rows.slice(0, -1);
    const profitRow = rows[rows.length - 1]!;
    const filteredRegular = regularRows.filter(
      (row) => row.description.trim() !== "" || lineItemRowAmount(row) > 0,
    );
    const regularSubtotal = filteredRegular.reduce((sum, row) => sum + lineItemRowAmount(row), 0);
    const profitPct = parseFloat(profitRow.qty) || 0;
    const profitAmount = Math.round(regularSubtotal * profitPct) / 100;

    return {
      name: fields.name,
      street: fields.street,
      city: fields.city,
      state: fields.state,
      zip: fields.zip,
      phone: fields.phone,
      invoiceNumber: fields.invoiceNumber,
      caseNumber: fields.caseNumber.trim(),
      ...revisionDocuments,
      lineItems: [
        ...filteredRegular.map((row) => ({
          description: row.description,
          qty: parseFloat(row.qty) || 0,
          unitPrice: parseFloat(row.unitPrice) || 0,
          amount: lineItemRowAmount(row),
        })),
        {
          description: PROFIT_DESCRIPTION,
          qty: profitPct,
          unitPrice: 0,
          amount: profitAmount,
        },
      ],
    };
  };

  const ensureBuilt = async (): Promise<BuiltInvoice> => {
    if (built) return built;
    const data = toVerifiedData();
    const result = await buildInvoice({
      name: data.name, street: data.street, city: data.city, state: data.state,
      zip: data.zip, phone: data.phone, invoiceNumber: data.invoiceNumber,
      caseNumber: data.caseNumber, lineItems: data.lineItems,
      invoiceDate: formatDisplayDate(invoiceDate),
    });
    setBuilt(result);
    return result;
  };

  const canSave = fields.name.trim() !== "";

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const version = editVersion.current;
      const data = toVerifiedData();
      const id = await saveInvoice({
        ...data,
        invoiceDate,
        id: invoiceId ?? persistedInvoiceId.current ?? undefined,
      });
      persistedInvoiceId.current = id;
      if (!invoiceId) {
        // Keep the association across refreshes; subsequent saves update this record.
        setSavedHydrated(true);
        router.replace(`/invoice-builder?id=${id}`);
      }
      if (editVersion.current === version) {
        setDirty(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the invoice.");
    } finally {
      setSaving(false);
    }
  };

  // Auto-save when focus leaves a form field. If a save is already in flight,
  // stay queued until it settles so edits made mid-save are persisted too.
  useEffect(() => {
    if (!autoSaveQueued || saving) return;
    setAutoSaveQueued(false);
    if (dirty && canSave) void handleSave();
  });

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

  const startPacket = async () => {
    if (pending) return;
    setPending("start");
    try {
      const { storageId } = await ensureBuilt();
      writeInvoiceDraft(workspaceId, {
        invoiceStorageId: storageId,
        data: { ...toVerifiedData(), ...revisionDocuments },
        invoiceId: invoiceId ?? persistedInvoiceId.current ?? undefined,
        invoiceDate,
      });
      router.push("/new-packet");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the invoice.");
      setPending(null);
    }
  };

  const handleStartPacket = () => {
    if (dirty) {
      setPendingNav({ kind: "startPacket" });
      return;
    }
    void startPacket();
  };

  const applyBundle = (bundleId: Id<"bundles">, bundleRows: LineItemRow[], documents: {
    documentId: Id<"customDocuments">; category: "waiver" | "spec-sheet" | "job-specific";
  }[]) => {
    const current = rows.slice(0, -1).filter(row => row.description.trim() || lineItemRowAmount(row) > 0);
    setRows([...current, ...bundleRows, rows[rows.length - 1]!]);
    setRevisionDocuments(previous => ({
      waiverIds: [...new Set([...(previous.waiverIds ?? []), ...documents.filter(doc => doc.category === "waiver").map(doc => doc.documentId)])],
      specSheetIds: [...new Set([...(previous.specSheetIds ?? []), ...documents.filter(doc => doc.category === "spec-sheet").map(doc => doc.documentId)])],
      jobSpecificIds: [...new Set([...(previous.jobSpecificIds ?? []), ...documents.filter(doc => doc.category === "job-specific").map(doc => doc.documentId)])],
    }));
    setAppliedBundleIds(previous => [...previous, bundleId]);
    markChanged();
  };

  const confirmLeave = () => {
    const nav = pendingNav;
    setPendingNav(null);
    if (!nav) return;
    if (nav.kind === "link") {
      router.push(nav.href as Route);
    } else {
      void startPacket();
    }
  };

  // If an auto-save settles while the "leave without saving?" prompt is up,
  // nothing is unsaved anymore — proceed with what the user asked for.
  useEffect(() => {
    if (!pendingNav || dirty || saving) return;
    confirmLeave();
  });

  if (settings === undefined || (invoiceId && !savedHydrated)) {
    return <BuilderSkeleton />;
  }

  if (settings === null) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:pt-10">
        <div className="mx-auto mt-12 flex max-w-lg flex-col items-center rounded-lg border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-lg bg-accent text-indigo-600 dark:text-indigo-400">
            <SettingsIcon className="size-7" />
          </div>
          <h1 className="mb-2 text-base font-semibold">Contractor settings are not configured</h1>
          <p className="mb-6 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Visit Settings before building invoices. Your contractor information fills the
            &ldquo;From&rdquo; section of every invoice.
          </p>
          <Link href="/settings" className={buttonVariants({ className: "h-10 rounded-md px-4" })}>
            Go to settings
          </Link>
        </div>
      </div>
    );
  }

  const itemCount =
    regularRows.filter((row) => row.description.trim() !== "" || lineItemRowAmount(row) > 0)
      .length + 1; // +1 for profit row

  const saveStatus = saving ? "Saving..." : dirty ? "Unsaved changes" : invoiceId ? "Saved" : "New draft";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:pt-10">
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-indigo-600 uppercase dark:text-indigo-400">
            Invoice workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[34px]">Invoice builder</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {invoiceId
              ? `Editing invoice ${fields.invoiceNumber || "saved invoice"}. Changes save automatically.`
              : "Add client details and line items, then start a packet."}
          </p>
          <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${saving || dirty ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : invoiceId ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
            <span className={`size-1.5 rounded-full ${saving || dirty ? "bg-amber-500" : invoiceId ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            {saveStatus}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/invoices" className={buttonVariants({ variant: "outline", className: "h-9 rounded-md" })}>
            <FilesIcon data-icon="inline-start" />
            All invoices
          </Link>
          <Link href="/bundles" className={buttonVariants({ variant: "outline", className: "h-9 rounded-md" })}>
            <BookOpenIcon data-icon="inline-start" />
            Bundles
          </Link>
        </div>
      </div>

      <div
        className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"
        onBlur={() => {
          if (dirty) setAutoSaveQueued(true);
        }}
      >
        <div className="min-w-0 space-y-5">

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <BuildingIcon className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-[15px] font-semibold tracking-[-0.02em]">From (contractor)</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Your business details on every invoice</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className={SECTION_CONTENT_CLASS}>
              <div className="space-y-0.5 text-xs">
                <p className="text-sm font-semibold">{settings.contractorCompanyName}</p>
                <p className="text-muted-foreground">
                  {settings.contractorName}
                  {settings.contractorLicense && ` · License #${settings.contractorLicense}`}
                </p>
                <p className="text-muted-foreground">
                  {settings.contractorStreet}, {settings.contractorCity}, {settings.contractorState}{" "}
                  {settings.contractorZip}
                </p>
                <p className="text-muted-foreground">
                  {settings.contractorPhone} · {settings.contractorEmail}
                </p>
              </div>
              <Link
                href="/settings"
                className="mt-4 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-indigo-400"
              >
                Edit in settings <ArrowRightIcon className="size-3" />
              </Link>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <UserRoundIcon className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-[15px] font-semibold tracking-[-0.02em]">Bill to (client)</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Who this invoice is for</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className={SECTION_CONTENT_CLASS}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {CLIENT_FIELDS.map(({ key, label }) => (
                  <div key={key} className={`space-y-1.5 ${key === "name" || key === "street" ? "sm:col-span-2" : ""}`}>
                    <Label htmlFor={`field-${key}`}>{label}</Label>
                    <Input
                      id={`field-${key}`}
                      className="h-10 bg-card"
                      value={fields[key]}
                      inputMode={key === "phone" ? "tel" : undefined}
                      onChange={(e) =>
                        setField(key, key === "phone" ? maskPhone(e.target.value) : e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <FileTextIcon className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-[15px] font-semibold tracking-[-0.02em]">Invoice details</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Reference numbers and date</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className={SECTION_CONTENT_CLASS}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="field-invoiceNumber">Invoice Number</Label>
                  <Input
                    id="field-invoiceNumber"
                    className="h-10 bg-card"
                    value={fields.invoiceNumber}
                    onChange={(e) => setField("invoiceNumber", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="field-invoiceDate">Invoice Date</Label>
                  <Input
                    id="field-invoiceDate"
                    className="h-10 bg-card"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => {
                      markChanged();
                      setInvoiceDate(e.target.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="field-caseNumber">SAH Case Number (required)</Label>
                  <Input
                    id="field-caseNumber"
                    className="h-10 bg-card"
                    value={fields.caseNumber}
                    onChange={(e) => setField("caseNumber", e.target.value)}
                    aria-invalid={fields.caseNumber.trim() === ""}
                    placeholder="Identification number from the invoice"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <ListChecksIcon className="size-4" />
                  </span>
                  <div>
                    <CardTitle className="text-[15px] font-semibold tracking-[-0.02em]">Line items</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">Work and pricing in construction order</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setBundlePickerOpen(true)}>
                    <PlusIcon data-icon="inline-start" /> Add bundle
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSaveBundleOpen(true)}>
                    Save as bundle
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className={SECTION_CONTENT_CLASS}>
              <LineItemsEditor rows={rows} onChange={handleRowsChange} />
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card className={SECTION_CARD_CLASS}>
            <CardHeader className={SECTION_HEADER_CLASS}>
              <CardTitle className="text-[15px] font-semibold tracking-[-0.02em]">Invoice summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 px-5 py-5">
              <div className="rounded-lg border border-indigo-500/15 bg-indigo-500/5 px-4 py-4">
                <p className="text-[10px] font-semibold tracking-[0.1em] text-indigo-700 uppercase dark:text-indigo-300">Invoice total</p>
                <p className="mt-2 font-mono text-2xl font-semibold tracking-[-0.05em] tabular-nums">{formatCurrency(total)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? "line item" : "line items"}</p>
              </div>
              {(() => {
                if (total <= 0) return null;
                const band = grantBand(total, maximumInvoiceAmount);
                if (band === "under") {
                  return (
                    <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                      Invoice is under {formatCurrency(minimumTargetAmount)}. Target between{" "}
                      {formatCurrency(minimumTargetAmount)} and {formatCurrency(maximumInvoiceAmount)}.
                    </div>
                  );
                }
                if (band === "over") {
                  return (
                    <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-xs text-red-700 dark:text-red-300">
                      Exceeds the {formatCurrency(maximumInvoiceAmount)} invoice maximum by{" "}
                      {formatCurrency(total - maximumInvoiceAmount)}.
                    </div>
                  );
                }
                return null;
              })()}
              <dl className="space-y-3 text-xs">
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
                  <dd className="font-mono tabular-nums">{formatCurrency(regularSubtotal)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Profit ({profitPct}%)</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(profitAmount)}</dd>
                </div>

                {total > maximumInvoiceAmount && (
                  <div className="flex justify-between gap-2 text-red-600 dark:text-red-400">
                    <dt>Over by</dt>
                    <dd className="font-mono tabular-nums">
                      {formatCurrency(total - maximumInvoiceAmount)}
                    </dd>
                  </div>
                )}
                {total < minimumTargetAmount && total > 0 && (
                  <div className="flex justify-between gap-2 text-amber-600 dark:text-amber-400">
                    <dt>Under by</dt>
                    <dd className="font-mono tabular-nums">
                      {formatCurrency(minimumTargetAmount - total)}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="flex flex-col gap-2 border-t border-border pt-5">
                <Button
                  variant="outline"
                  className="h-10 rounded-md"
                  disabled={!canBuild || pending !== null}
                  onClick={handleDownload}
                >
                  <DownloadIcon data-icon="inline-start" />
                  {pending === "download" ? "Building..." : "Download Invoice"}
                </Button>
                <Button className="h-10 rounded-md" disabled={!canBuild || pending !== null} onClick={handleStartPacket}>
                  {pending === "start" ? "Building..." : "Start Packet"}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={pendingNav !== null}
        title="Leave without saving?"
        description="You have unsaved changes that will be lost if you leave this page."
        confirmLabel="Leave"
        onConfirm={confirmLeave}
        onCancel={() => setPendingNav(null)}
      />

      <BundlePicker open={bundlePickerOpen} onClose={() => setBundlePickerOpen(false)} onApply={applyBundle} currentSubtotal={regularSubtotal} profitPct={profitPct} currentItemCount={regularRows.filter(row => row.description.trim() || lineItemRowAmount(row) > 0).length} currentDocumentIds={[...(revisionDocuments.waiverIds ?? []), ...(revisionDocuments.specSheetIds ?? []), ...(revisionDocuments.jobSpecificIds ?? [])]} appliedIds={appliedBundleIds} />
      <SaveAsBundle open={saveBundleOpen} onClose={() => setSaveBundleOpen(false)} rows={regularRows} documents={revisionDocuments} />
    </div>
  );
}
