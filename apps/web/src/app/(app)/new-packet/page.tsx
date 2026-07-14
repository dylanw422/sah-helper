"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Label } from "@sah-helper/ui/components/label";
import { useAction, useMutation } from "convex/react";
import { AlertCircleIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CompleteStep } from "@/components/wizard/complete-step";
import { DrawCountSelect, type DrawCount } from "@/components/wizard/draw-count-select";
import {
  ProcessingStepList,
  ProgressBar,
  type StepState,
} from "@/components/wizard/processing-steps";
import { StepIndicator } from "@/components/wizard/step-indicator";
import { UploadStep } from "@/components/wizard/upload-step";
import { VerifyStep, type VerifiedData } from "@/components/wizard/verify-step";
import { consumeInvoiceDraft } from "@/lib/invoice-draft";
import { formatCurrency, formatDisplayDate } from "@/lib/format";

const EXTRACTION_STEPS = [
  "Uploading invoice...",
  "Reading document with AI...",
  "Extracting client details...",
  "Extracting line items...",
  "Preparing verification...",
] as const;

const GENERATION_STEPS = [
  "Filling Construction Contract...",
  "Filling VA Addendum...",
  "Filling Builder Spec Sheet...",
  "Filling Scope of Work...",
  "Filling Payment Schedule...",
  "Merging documents...",
  "Saving to client record...",
  "Packet ready!",
] as const;

type WizardPhase = "upload" | "extracting" | "draw-count" | "verify" | "generating" | "complete";

type ExtractedData = VerifiedData & { totalMismatchWarning: boolean };

function toStepStates(total: number, doneCount: number, processing: boolean): StepState[] {
  return Array.from({ length: total }, (_, i) => {
    if (i < doneCount) return "done";
    if (i === doneCount && processing) return "active";
    return "pending";
  });
}

export default function NewPacketPage() {
  const [phase, setPhase] = useState<WizardPhase>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [savedInvoice, setSavedInvoice] = useState<Doc<"invoices"> | null>(null);
  const [preparingSaved, setPreparingSaved] = useState(false);
  const [drawCount, setDrawCount] = useState<DrawCount | null>(null);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [invoiceStorageId, setInvoiceStorageId] = useState<Id<"_storage"> | null>(null);
  const [verified, setVerified] = useState<VerifiedData | null>(null);
  const [result, setResult] = useState<{
    clientId: Id<"clients">;
    clientName: string;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [fromBuilder, setFromBuilder] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const parseInvoice = useAction(api.invoices.parseInvoice);
  const generatePacket = useAction(api.packets.generatePacket);
  const buildInvoice = useAction(api.invoiceBuilder.buildInvoice);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // A draft written by the Invoice Builder skips upload + AI extraction:
  // the data is already structured, only the draw count is missing.
  useEffect(() => {
    const draft = consumeInvoiceDraft();
    if (!draft) return;
    setInvoiceStorageId(draft.invoiceStorageId);
    setExtracted({ ...draft.data, totalMismatchWarning: false });
    setFromBuilder(true);
    setPhase("draw-count");
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timeoutsRef.current.push(setTimeout(fn, ms));
  }, []);

  const startExtraction = useCallback(
    async (selectedFile: File, selectedDrawCount: DrawCount) => {
      setFile(selectedFile);
      setSavedInvoice(null);
      setDrawCount(selectedDrawCount);
      setError(null);
      setDoneCount(0);
      setPhase("extracting");

      try {
        const uploadUrl = await generateUploadUrl();
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: selectedFile,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
        setInvoiceStorageId(storageId);
        setDoneCount(1);

        // Cosmetic progress while the AI call runs
        intervalRef.current = setInterval(() => {
          setDoneCount((c) => Math.min(c + 1, 3));
        }, 1500);

        const data = await parseInvoice({ storageId });
        clearTimers();
        setDoneCount(4);
        later(() => setDoneCount(5), 500);
        later(() => {
          setExtracted({
            name: data.clientName,
            street: data.clientStreet,
            city: data.clientCity,
            state: data.clientState,
            zip: data.clientZip,
            phone: data.clientPhone,
            invoiceNumber: data.invoiceNumber,
            caseNumber: data.caseNumber,
            lineItems: data.lineItems,
            totalMismatchWarning: data.totalMismatchWarning,
          });
          setPhase("verify");
        }, 1100);
      } catch (e) {
        clearTimers();
        setError(e instanceof Error ? e.message : "Something went wrong while reading the invoice.");
      }
    },
    [generateUploadUrl, parseInvoice, clearTimers, later],
  );

  // A saved invoice is already structured data, so AI extraction is skipped;
  // the PDF is rebuilt only because the packet stores a copy of it.
  const startFromSaved = useCallback(
    async (invoice: Doc<"invoices">, selectedDrawCount: DrawCount) => {
      setSavedInvoice(invoice);
      setFile(null);
      setDrawCount(selectedDrawCount);
      setError(null);
      setPreparingSaved(true);

      try {
        const { storageId } = await buildInvoice({
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
        setInvoiceStorageId(storageId);
        setExtracted({
          name: invoice.name,
          street: invoice.street,
          city: invoice.city,
          state: invoice.state,
          zip: invoice.zip,
          phone: invoice.phone,
          invoiceNumber: invoice.invoiceNumber,
          caseNumber: invoice.caseNumber,
          lineItems: invoice.lineItems,
          totalMismatchWarning: false,
        });
        setPhase("verify");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong while preparing the invoice.");
      } finally {
        setPreparingSaved(false);
      }
    },
    [buildInvoice],
  );

  const startGeneration = useCallback(
    async (data: VerifiedData) => {
      if (!drawCount || !invoiceStorageId) return;
      setVerified(data);
      setError(null);
      setDoneCount(0);
      setPhase("generating");

      intervalRef.current = setInterval(() => {
        setDoneCount((c) => Math.min(c + 1, 7));
      }, 900);

      try {
        const res = await generatePacket({
          name: data.name,
          street: data.street,
          city: data.city,
          state: data.state,
          zip: data.zip,
          phone: data.phone,
          invoiceNumber: data.invoiceNumber,
          caseNumber: data.caseNumber.trim(),
          drawCount,
          lineItems: data.lineItems,
          invoiceStorageId,
          waiverIds: data.waiverIds ?? [],
          specSheetIds: data.specSheetIds ?? [],
          jobSpecificIds: data.jobSpecificIds ?? [],
        });
        clearTimers();
        setDoneCount(8);
        later(() => setDoneCount(9), 500);
        later(() => {
          setResult({
            clientId: res.clientId,
            clientName: data.name,
            total: data.lineItems.reduce((sum, item) => sum + item.amount, 0),
          });
          setPhase("complete");
        }, 1100);
      } catch (e) {
        clearTimers();
        setError(e instanceof Error ? e.message : "Something went wrong while generating the packet.");
      }
    },
    [drawCount, invoiceStorageId, generatePacket, clearTimers, later],
  );

  const restart = useCallback(() => {
    clearTimers();
    setPhase("upload");
    setFile(null);
    setSavedInvoice(null);
    setDrawCount(null);
    setExtracted(null);
    setInvoiceStorageId(null);
    setVerified(null);
    setResult(null);
    setError(null);
    setDoneCount(0);
    setFromBuilder(false);
  }, [clearTimers]);

  const stepIndex =
    phase === "upload"
      ? 0
      : phase === "extracting" || phase === "draw-count"
        ? 1
        : phase === "verify"
          ? 2
          : 3;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <StepIndicator currentIndex={stepIndex} />
      <AnimatePresence mode="wait">
        <motion.div
          key={phase + (error ? "-error" : "")}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {error ? (
            <ErrorState
              message={error}
              onRetry={() => {
                setError(null);
                if (phase === "generating" && verified) {
                  startGeneration(verified);
                } else {
                  setPhase("upload");
                }
              }}
            />
          ) : phase === "upload" ? (
            <UploadStep
              onSubmit={startExtraction}
              onSubmitSaved={startFromSaved}
              initialFile={file}
              initialSavedInvoice={savedInvoice}
              initialDrawCount={drawCount}
              busy={preparingSaved}
            />
          ) : phase === "extracting" ? (
            <ProcessingView
              title="Reading your invoice"
              steps={EXTRACTION_STEPS}
              doneCount={doneCount}
            />
          ) : phase === "draw-count" && extracted ? (
            <DrawCountStep
              data={extracted}
              drawCount={drawCount}
              onDrawCountChange={setDrawCount}
              onContinue={() => setPhase("verify")}
            />
          ) : phase === "verify" && extracted && drawCount ? (
            <VerifyStep
              initial={verified ?? extracted}
              drawCount={drawCount}
              totalMismatchWarning={extracted.totalMismatchWarning}
              onBack={() => setPhase(fromBuilder ? "draw-count" : "upload")}
              onGenerate={startGeneration}
            />
          ) : phase === "generating" ? (
            <ProcessingView
              title="Generating your packet"
              steps={GENERATION_STEPS}
              doneCount={doneCount}
              showProgress
            />
          ) : phase === "complete" && result ? (
            <CompleteStep
              clientId={result.clientId}
              clientName={result.clientName}
              total={result.total}
              onRestart={restart}
            />
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ProcessingView({
  title,
  steps,
  doneCount,
  showProgress = false,
}: {
  title: string;
  steps: readonly string[];
  doneCount: number;
  showProgress?: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col pt-10">
      {showProgress && (
        <div className="mb-8">
          <ProgressBar progress={(doneCount / steps.length) * 100} />
        </div>
      )}
      <h1 className="mb-8 text-center text-xl font-semibold tracking-tight">{title}</h1>
      <ProcessingStepList
        steps={steps}
        states={toStepStates(steps.length, doneCount, doneCount < steps.length)}
      />
    </div>
  );
}

function DrawCountStep({
  data,
  drawCount,
  onDrawCountChange,
  onContinue,
}: {
  data: ExtractedData;
  drawCount: DrawCount | null;
  onDrawCountChange: (value: DrawCount) => void;
  onContinue: () => void;
}) {
  const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="mx-auto w-full max-w-md pt-6">
      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">Almost there</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Your invoice is ready. Select the number of draws for this job to continue.
      </p>

      <div className="mb-6 rounded-md border border-border bg-card px-4 py-3 text-xs">
        <p className="font-medium">
          Invoice ready: {data.invoiceNumber || "No number"} · {data.name}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          <span className="font-mono tabular-nums">{formatCurrency(total)}</span> ·{" "}
          {data.lineItems.length} line item{data.lineItems.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="draw-count">Draw Count</Label>
        <DrawCountSelect value={drawCount} onChange={onDrawCountChange} />
      </div>

      <Button size="lg" className="mt-6 w-full" disabled={!drawCount} onClick={onContinue}>
        Continue to Verify
      </Button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center pt-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center bg-destructive/10 text-destructive">
        <AlertCircleIcon className="size-6" />
      </div>
      <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
      <p className="mb-6 text-xs text-muted-foreground">{message}</p>
      <Button onClick={onRetry}>Try Again</Button>
    </div>
  );
}
