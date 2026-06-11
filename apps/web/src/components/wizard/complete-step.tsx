"use client";

import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { api } from "@sah-helper/backend/convex/_generated/api";
import { Button } from "@sah-helper/ui/components/button";
import confetti from "canvas-confetti";
import { useQuery } from "convex/react";
import { DownloadIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
}: {
  clientId: Id<"clients">;
  clientName: string;
  total: number;
  onRestart: () => void;
}) {
  const downloadUrl = useQuery(api.clients.getPacketDownloadUrl, { clientId });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const colors = ["#6366f1", "#34d399", "#f59e0b"];
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 }, colors });
    const timer = setTimeout(
      () => confetti({ particleCount: 50, spread: 100, origin: { y: 0.4 }, colors }),
      350,
    );
    return () => clearTimeout(timer);
  }, []);

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
    </div>
  );
}
