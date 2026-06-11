"use client";

import { motion } from "motion/react";

import { STATUS_LABELS, type ClientStatus } from "@/lib/format";

const CONFIG: Record<
  ClientStatus,
  { dot: string; bg: string; text: string; ring: string }
> = {
  unsigned: {
    dot: "bg-amber-400",
    bg: "bg-amber-400/10",
    text: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-400/20",
  },
  signed: {
    dot: "bg-indigo-400",
    bg: "bg-indigo-400/10",
    text: "text-indigo-600 dark:text-indigo-400",
    ring: "ring-indigo-400/20",
  },
  complete: {
    dot: "bg-emerald-400",
    bg: "bg-emerald-400/10",
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-400/20",
  },
};

export function StatusBadge({ status }: { status: ClientStatus }) {
  const c = CONFIG[status];
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 600, damping: 20 }}
      className={`relative inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase ring-1 ${c.bg} ${c.text} ${c.ring}`}
    >
      {status === "unsigned" && (
        <motion.span
          className={`absolute inset-0 rounded-sm ${c.bg}`}
          animate={{ opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />
      <span className="relative">{STATUS_LABELS[status]}</span>
    </motion.span>
  );
}
