"use client";

import {
  CheckIcon,
  CheckSquareIcon,
  DownloadIcon,
  UploadIcon,
  ZapIcon,
} from "lucide-react";
import { motion } from "motion/react";

const STEPS = [
  { key: "upload", label: "Upload Invoice", icon: UploadIcon },
  { key: "processing", label: "AI Extraction", icon: ZapIcon },
  { key: "verify", label: "Verify Data", icon: CheckSquareIcon },
  { key: "complete", label: "Download Packet", icon: DownloadIcon },
] as const;

export function StepIndicator({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="mx-auto mb-10 flex w-full max-w-2xl items-center">
      {STEPS.map(({ key, label, icon: Icon }, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
        return (
          <div key={key} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
            {i > 0 && (
              <div className="relative mx-2 h-px flex-1 bg-border sm:mx-3">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-indigo-500"
                  initial={false}
                  animate={{ width: i <= currentIndex ? "100%" : "0%" }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                />
              </div>
            )}
            <div className="flex flex-col items-center gap-1.5">
              <motion.div
                initial={false}
                animate={state}
                variants={{
                  pending: { scale: 1 },
                  active: { scale: 1.06 },
                  done: { scale: 1 },
                }}
                transition={{ type: "spring", stiffness: 600, damping: 20 }}
                className={`flex size-8 items-center justify-center rounded-md ring-1 transition-colors duration-300 ${
                  state === "done"
                    ? "bg-emerald-400/15 text-emerald-500 ring-emerald-400/30 dark:text-emerald-400"
                    : state === "active"
                      ? "bg-indigo-500 text-white ring-indigo-400/60 shadow-[0_0_16px_-2px_rgb(99_102_241/0.7)]"
                      : "bg-card text-muted-foreground/50 ring-border"
                }`}
              >
                {state === "done" ? <CheckIcon className="size-4" /> : <Icon className="size-4" />}
              </motion.div>
              <span
                className={`hidden text-[10px] font-medium tracking-[0.08em] uppercase sm:block ${
                  state === "pending" ? "text-muted-foreground/50" : "text-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
