"use client";

import { Button } from "@sah-helper/ui/components/button";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirming = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm rounded-md border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1.5 text-sm font-semibold">{title}</h2>
            <p className="mb-5 text-xs text-muted-foreground">{description}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onCancel} disabled={confirming}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onConfirm} disabled={confirming}>
                {confirming ? "Deleting..." : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
