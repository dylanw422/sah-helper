"use client";

import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { api } from "@sah-helper/backend/convex/_generated/api";
import { Button } from "@sah-helper/ui/components/button";
import confetti from "canvas-confetti";
import { useQuery } from "convex/react";
import { DownloadIcon, EyeIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { downloadFile } from "@/lib/download";
import { formatCurrency } from "@/lib/format";

import { AnimatedCheck } from "./processing-steps";

export async function downloadPacket(url: string) {
  return downloadFile(url, "Packet.pdf");
}

export function CompleteStep({
  clientId,
  clientName,
  total,
  onRestart,
  onRevise,
}: {
  clientId: Id<"clients">;
  clientName: string;
  total: number;
  onRestart: () => void;
  onRevise: () => void;
}) {
  const downloadUrl = useQuery(api.clients.getPacketDownloadUrl, { clientId });
  const [downloading, setDownloading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const colors = ["#6366f1", "#34d399", "#f59e0b"];
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 }, colors });
    const timer = setTimeout(
      () => confetti({ particleCount: 50, spread: 100, origin: { y: 0.4 }, colors }),
      350,
    );
    return () => clearTimeout(timer);
  }, []);

  const closePreview = useCallback(() => {
    previewRequest.current?.abort();
    previewRequest.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewLoading(false);
    setPreviewOpen(false);
  }, [previewUrl]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen, closePreview]);

  useEffect(() => () => previewRequest.current?.abort(), []);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handlePreview = async () => {
    if (!downloadUrl || previewOpen) return;
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const response = await fetch(downloadUrl, { signal: controller.signal });
      if (!response.ok) throw new Error("Could not load packet preview.");
      const blob = await response.blob();
      if (previewRequest.current !== controller) return;
      const pdf = blob.type === "application/pdf"
        ? blob
        : new Blob([blob], { type: "application/pdf" });
      setPreviewUrl(URL.createObjectURL(pdf));
    } catch (error) {
      if (controller.signal.aborted) return;
      setPreviewOpen(false);
      toast.error(error instanceof Error ? error.message : "Could not load packet preview.");
    } finally {
      if (previewRequest.current === controller) {
        previewRequest.current = null;
        setPreviewLoading(false);
      }
    }
  };

  const handleDownload = async () => {
    if (!downloadUrl) return;
    setDownloading(true);
    try {
      await downloadPacket(downloadUrl);
    } catch {
      toast.error("Could not download the packet. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center pt-10 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 600, damping: 20 }}
        className="mb-6 flex size-16 items-center justify-center rounded-md bg-emerald-400/15 ring-1 ring-emerald-400/25"
      >
        <AnimatedCheck className="size-9" />
      </motion.div>

      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">
        Packet ready for <span className="text-indigo-600 dark:text-indigo-400">{clientName}</span>
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Total contract amount:{" "}
        <span className="font-mono font-medium text-foreground tabular-nums">
          {formatCurrency(total)}
        </span>
      </p>

      <motion.div
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        className="w-full"
      >
        <Button
          size="lg"
          className="w-full"
          disabled={!downloadUrl || downloading}
          onClick={handleDownload}
        >
          <DownloadIcon data-icon="inline-start" />
          {downloading ? "Downloading..." : "Download Packet.pdf"}
        </Button>
      </motion.div>

      <div className="mt-3 grid w-full grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          disabled={!downloadUrl || previewLoading}
          onClick={handlePreview}
        >
          <EyeIcon data-icon="inline-start" />
          Preview Packet
        </Button>
        <Button variant="outline" size="lg" onClick={onRevise}>
          <PencilIcon data-icon="inline-start" />
          Revise Invoice
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        After revising the invoice, generate a new packet to replace this one.
      </p>

      <div className="mt-6 flex items-center gap-4 text-xs">
        <Link href={`/clients/${clientId}`} className="text-primary underline-offset-4 hover:underline">
          View Client Record
        </Link>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={onRestart}
          className="text-primary underline-offset-4 hover:underline"
        >
          Process Another Invoice
        </button>
      </div>
      {previewOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
          onClick={closePreview}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Packet preview"
            className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-card text-left shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Packet preview</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close preview"
                onClick={closePreview}
                autoFocus
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            {previewUrl ? (
              <iframe title="Packet PDF" src={previewUrl} className="min-h-0 w-full flex-1 bg-white" />
            ) : (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading packet...
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
