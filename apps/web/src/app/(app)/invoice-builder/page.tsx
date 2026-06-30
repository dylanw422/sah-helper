"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { Textarea } from "@sah-helper/ui/components/textarea";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BuildingIcon,
  ChevronDownIcon,
  DownloadIcon,
  FilesIcon,
  MicIcon,
  MicOffIcon,
  SettingsIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { grantBand, MAX_GRANT_AMOUNT, MIN_TARGET_AMOUNT } from "@/lib/grant";
import { writeInvoiceDraft } from "@/lib/invoice-draft";

type BuiltInvoice = { storageId: Id<"_storage">; url: string };

type PendingNav = { kind: "link"; href: string } | { kind: "startPacket" };

function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function savedLineItemsToRows(items: VerifiedData["lineItems"]): LineItemRow[] {
  const rows: LineItemRow[] = items.map((item) => ({
    id: crypto.randomUUID(),
    description: item.description,
    qty: String(item.qty),
    unitPrice: String(item.unitPrice),
  }));
  if (rows[rows.length - 1]?.description !== PROFIT_DESCRIPTION) {
    rows.push(createProfitRow());
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

function BuilderSkeleton() {
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
  const suggestedNumber = useQuery(
    api.invoiceBuilder.suggestInvoiceNumber,
    invoiceId ? "skip" : {},
  );
  const saved = useQuery(api.invoiceBuilder.getInvoice, invoiceId ? { id: invoiceId } : "skip");
  const buildInvoice = useAction(api.invoiceBuilder.buildInvoice);
  const saveInvoice = useMutation(api.invoiceBuilder.saveInvoice);
  const generateLineItems = useAction(api.invoiceGenerator.generateLineItems);

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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [pendingAiRows, setPendingAiRows] = useState<LineItemRow[] | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const voiceBaseTextRef = useRef("");
  // Incremented on every edit; a save only clears `dirty` if no edits landed
  // while the save request was in flight.
  const editVersion = useRef(0);
  const [autoSaveQueued, setAutoSaveQueued] = useState(false);
  const lineItemsCardRef = useRef<HTMLDivElement>(null);

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
    if (!invoiceId || savedHydrated) return;
    if (saved === null) {
      toast.error("That invoice no longer exists.");
      router.replace("/invoice-builder");
      return;
    }
    if (saved === undefined) return;
    setFields({
      name: saved.name,
      street: saved.street,
      city: saved.city,
      state: saved.state,
      zip: saved.zip,
      phone: saved.phone,
      invoiceNumber: saved.invoiceNumber,
      caseNumber: saved.caseNumber,
    });
    setInvoiceDate(saved.invoiceDate);
    setRows(savedLineItemsToRows(saved.lineItems));
    setDirty(false);
    setSavedHydrated(true);
  }, [invoiceId, saved, savedHydrated, router]);

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
  const profitAmount = regularSubtotal * (profitPct / 100);
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
    const profitAmount = regularSubtotal * (profitPct / 100);

    return {
      name: fields.name,
      street: fields.street,
      city: fields.city,
      state: fields.state,
      zip: fields.zip,
      phone: fields.phone,
      invoiceNumber: fields.invoiceNumber,
      caseNumber: fields.caseNumber.trim(),
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
      ...data,
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
        id: invoiceId ?? undefined,
      });
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
      writeInvoiceDraft({ invoiceStorageId: storageId, data: toVerifiedData() });
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

  // Stop recognition when the drawer closes so it doesn't run in the background.
  useEffect(() => {
    if (!aiOpen && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, [aiOpen]);

  // Ensure recognition is stopped if the component unmounts.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const SpeechRecognitionAPI = (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"]) as
      | (new () => {
          continuous: boolean;
          interimResults: boolean;
          lang: string;
          onresult: ((e: { results: { [i: number]: { [i: number]: { transcript: string } } } }) => void) | null;
          onend: (() => void) | null;
          onerror: ((e: { error: string }) => void) | null;
          start: () => void;
          stop: () => void;
        })
      | undefined;
    if (!SpeechRecognitionAPI) {
      toast.error("Voice input is not supported in this browser.");
      return;
    }
    voiceBaseTextRef.current = aiDescription.trimEnd();
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < Object.keys(event.results).length; i++) {
        transcript += event.results[i]![0]!.transcript;
      }
      const base = voiceBaseTextRef.current;
      setAiDescription(base ? `${base} ${transcript}` : transcript);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech") {
        toast.error("Voice input stopped. Please try again.");
      }
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleGenerate = async () => {
    if (aiGenerating || !aiDescription.trim()) return;
    setAiGenerating(true);
    try {
      const result = await generateLineItems({ description: aiDescription });
      setAiNotes(result.notes);
      if (result.items.length === 0) return;
      const newRows: LineItemRow[] = result.items.map((item) => ({
        id: crypto.randomUUID(),
        description: item.description,
        qty: String(item.qty),
        unitPrice: String(item.unitPrice),
        isEstimate: item.isEstimate,
      }));
      const hasRows = regularRows.some(
        (row) => row.description.trim() !== "" || lineItemRowAmount(row) > 0,
      );
      if (hasRows) {
        setPendingAiRows(newRows);
      } else {
        setRows([...newRows, profitRow]);
        markChanged();
        scrollToLineItems();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate line items.");
    } finally {
      setAiGenerating(false);
    }
  };

  const scrollToLineItems = () => {
    setTimeout(() => {
      lineItemsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const confirmReplaceRows = () => {
    if (!pendingAiRows) return;
    setRows([...pendingAiRows, profitRow]);
    markChanged();
    setPendingAiRows(null);
    scrollToLineItems();
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

  const itemCount =
    regularRows.filter((row) => row.description.trim() !== "" || lineItemRowAmount(row) > 0)
      .length + 1; // +1 for profit row

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">Invoice Builder</h1>
          <p className="text-xs text-muted-foreground">
            {invoiceId
              ? `Editing ${fields.invoiceNumber || "saved invoice"} — saving updates this invoice.`
              : "Compose a new invoice. Drag line items to set construction order."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/catalog" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <BookOpenIcon data-icon="inline-start" />
            Catalog
          </Link>
          <Link href="/invoices" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <FilesIcon data-icon="inline-start" />
            Saved Invoices
          </Link>
        </div>
      </div>

      <div
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]"
        onBlur={() => {
          if (dirty) setAutoSaveQueued(true);
        }}
      >
        <div className="min-w-0 space-y-6">
          {/* Generate with AI card — disabled pending further testing */}

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
                  {settings.contractorStreet}, {settings.contractorCity}, {settings.contractorState}{" "}
                  {settings.contractorZip}
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
                      markChanged();
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

          {aiNotes.length > 0 && (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
              <div className="flex-1 space-y-0.5">
                {aiNotes.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
              </div>
              <button
                type="button"
                aria-label="Dismiss notes"
                onClick={() => setAiNotes([])}
                className="mt-0.5 shrink-0 opacity-60 hover:opacity-100"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          )}

          <Card ref={lineItemsCardRef}>
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
              {(() => {
                const band = grantBand(total);
                if (band === "under") {
                  return (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      Invoice is under {formatCurrency(MIN_TARGET_AMOUNT)}. Target between{" "}
                      {formatCurrency(MIN_TARGET_AMOUNT)} and {formatCurrency(MAX_GRANT_AMOUNT)}.
                    </div>
                  );
                }
                if (band === "over") {
                  return (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                      Exceeds the {formatCurrency(MAX_GRANT_AMOUNT)} SAH grant maximum by{" "}
                      {formatCurrency(total - MAX_GRANT_AMOUNT)}.
                    </div>
                  );
                }
                return null;
              })()}
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
                <div className="flex justify-between gap-2 border-t pt-2 text-sm font-semibold">
                  <dt>Total</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(total)}</dd>
                </div>

                {total >= MAX_GRANT_AMOUNT && (
                  <div className="flex justify-between gap-2 text-red-600 dark:text-red-400">
                    <dt>Over by</dt>
                    <dd className="font-mono tabular-nums">
                      {formatCurrency(total - MAX_GRANT_AMOUNT)}
                    </dd>
                  </div>
                )}
                {total < MIN_TARGET_AMOUNT && total > 0 && (
                  <div className="flex justify-between gap-2 text-amber-600 dark:text-amber-400">
                    <dt>Under by</dt>
                    <dd className="font-mono tabular-nums">
                      {formatCurrency(MIN_TARGET_AMOUNT - total)}
                    </dd>
                  </div>
                )}
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

      <ConfirmDialog
        open={pendingNav !== null}
        title="Leave without saving?"
        description="You have unsaved changes that will be lost if you leave this page."
        confirmLabel="Leave"
        onConfirm={confirmLeave}
        onCancel={() => setPendingNav(null)}
      />

      <ConfirmDialog
        open={pendingAiRows !== null}
        title="Replace current line items?"
        description="This will replace your existing line items with the AI-generated ones. This cannot be undone."
        confirmLabel="Replace"
        onConfirm={confirmReplaceRows}
        onCancel={() => setPendingAiRows(null)}
      />
    </div>
  );
}
