"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useQuery } from "convex/react";
import { ChevronDownIcon, FileTextIcon, SearchIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";

import { formatCurrency } from "@/lib/format";

import { DrawCountSelect, type DrawCount } from "./draw-count-select";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function CornerAccents() {
  const corners = [
    "top-2 left-2 border-t-2 border-l-2",
    "top-2 right-2 border-t-2 border-r-2",
    "bottom-2 left-2 border-b-2 border-l-2",
    "bottom-2 right-2 border-b-2 border-r-2",
  ];
  return (
    <>
      {corners.map((pos) => (
        <motion.span
          key={pos}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ type: "spring", stiffness: 600, damping: 20 }}
          className={`pointer-events-none absolute size-5 rounded-[1px] border-indigo-400 ${pos}`}
        />
      ))}
    </>
  );
}

export function UploadStep({
  onSubmit,
  onSubmitSaved,
  initialFile,
  initialSavedInvoice,
  initialDrawCount,
  busy = false,
}: {
  onSubmit: (file: File, drawCount: DrawCount) => void;
  onSubmitSaved: (invoice: Doc<"invoices">, drawCount: DrawCount) => void;
  initialFile?: File | null;
  initialSavedInvoice?: Doc<"invoices"> | null;
  initialDrawCount?: DrawCount | null;
  busy?: boolean;
}) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [savedInvoice, setSavedInvoice] = useState<Doc<"invoices"> | null>(
    initialSavedInvoice ?? null,
  );
  const [showSaved, setShowSaved] = useState(false);
  const [savedSearch, setSavedSearch] = useState("");
  const [drawCount, setDrawCount] = useState<DrawCount | null>(initialDrawCount ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Loaded eagerly so the drawer's content (and therefore its measured auto
  // height) is stable by the time it animates open.
  const savedInvoices = useQuery(api.invoiceBuilder.listInvoices);

  const search = savedSearch.trim().toLowerCase();
  const filteredInvoices = (savedInvoices ?? []).filter(
    (invoice) =>
      !search ||
      invoice.invoiceNumber.toLowerCase().includes(search) ||
      invoice.name.toLowerCase().includes(search),
  );

  const handleFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.");
      return;
    }
    if (f.size > MAX_SIZE_BYTES) {
      setError("File is too large. Maximum size is 10MB.");
      return;
    }
    setSavedInvoice(null);
    setFile(f);
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">New Packet</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Upload an invoice PDF or pick a saved invoice, then select the number of draws for this
        job.
      </p>

      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
        initial={false}
        animate={dragOver ? { scale: 1.012 } : { scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={`relative flex min-h-[240px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-6 text-center select-none transition-colors duration-200 ${
          dragOver
            ? "border-indigo-500 bg-accent"
            : "border-border bg-card hover:border-[rgb(var(--border-default-rgb)/var(--border-hover-alpha))]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <AnimatePresence>{dragOver && <CornerAccents />}</AnimatePresence>

        {savedInvoice ? (
          <>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 600, damping: 20 }}
              className="mb-3 flex size-14 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400"
            >
              <FileTextIcon className="size-7" />
            </motion.div>
            <p className="text-sm font-medium">
              <span className="font-mono">{savedInvoice.invoiceNumber || "No number"}</span>
              {savedInvoice.name && <span> · {savedInvoice.name}</span>}
            </p>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {formatCurrency(savedInvoice.total)} · {savedInvoice.lineItems.length}{" "}
              {savedInvoice.lineItems.length === 1 ? "item" : "items"}
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-2"
              onClick={(e) => {
                e.stopPropagation();
                setSavedInvoice(null);
              }}
            >
              <XIcon data-icon="inline-start" />
              Remove
            </Button>
          </>
        ) : file ? (
          <>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 600, damping: 20 }}
              className="mb-3 flex size-14 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400"
            >
              <FileTextIcon className="size-7" />
            </motion.div>
            <p className="text-sm font-medium">{file.name}</p>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-2"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <XIcon data-icon="inline-start" />
              Remove
            </Button>
          </>
        ) : (
          <>
            <motion.div
              animate={
                dragOver ? { scale: 1.3, rotate: -8 } : { scale: 1, rotate: 0, y: [0, -4, 0] }
              }
              transition={
                dragOver
                  ? { type: "spring", stiffness: 500, damping: 22 }
                  : { y: { duration: 2.4, repeat: Infinity, ease: "easeInOut" } }
              }
              className="mb-3 flex size-14 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400"
            >
              <UploadCloudIcon className="size-7" />
            </motion.div>
            <p className="text-sm font-medium">
              {dragOver ? "Release to upload" : "Drop invoice PDF here"}
            </p>
            <p className="text-xs text-muted-foreground">
              or <span className="text-indigo-600 hover:underline dark:text-indigo-400">browse files</span>
            </p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/60">PDF · max 10MB</p>
          </>
        )}
      </motion.div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowSaved((s) => !s)}
          className="mx-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          or select from saved invoices
          <ChevronDownIcon
            className={`size-3.5 transition-transform duration-200 ${showSaved ? "rotate-180" : ""}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {showSaved && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              {/* Padding instead of margin: margins are excluded from the
                  animated height measurement and cause a jump at the end. */}
              <div className="space-y-2 pt-3">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                  <input
                    type="text"
                    value={savedSearch}
                    onChange={(e) => setSavedSearch(e.target.value)}
                    placeholder="Search by client name or invoice #"
                    className="h-8 w-full rounded-md border border-border bg-card pr-3 pl-9 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-ring"
                  />
                </div>
                <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
                {savedInvoices === undefined ? (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : savedInvoices.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No saved invoices yet. Build one in the Invoice Builder first.
                  </p>
                ) : filteredInvoices.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No invoices match &ldquo;{savedSearch.trim()}&rdquo;.
                  </p>
                ) : (
                  filteredInvoices.map((invoice) => (
                    <button
                      key={invoice._id}
                      type="button"
                      onClick={() => {
                        setError(null);
                        setFile(null);
                        if (inputRef.current) inputRef.current.value = "";
                        setSavedInvoice(invoice);
                        setShowSaved(false);
                        setSavedSearch("");
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                    >
                      <FileTextIcon className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          <span className="font-mono">{invoice.invoiceNumber || "—"}</span>
                          {invoice.name && <span className="font-normal"> · {invoice.name}</span>}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground/70">
                          {formatCurrency(invoice.total)} · {invoice.lineItems.length}{" "}
                          {invoice.lineItems.length === 1 ? "item" : "items"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 space-y-2">
        <Label htmlFor="draw-count">Draw Count</Label>
        <DrawCountSelect value={drawCount} onChange={setDrawCount} />
      </div>

      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={(!file && !savedInvoice) || !drawCount || busy}
        onClick={() => {
          if (!drawCount) return;
          if (savedInvoice) onSubmitSaved(savedInvoice, drawCount);
          else if (file) onSubmit(file, drawCount);
        }}
      >
        {busy ? "Preparing Invoice..." : "Process Invoice"}
      </Button>
    </div>
  );
}
