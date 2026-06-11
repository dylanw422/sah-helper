"use client";

import { motion } from "motion/react";

export function AnimatedCheck({ className = "size-5" }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} text-emerald-500 dark:text-emerald-400`}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.path
        d="M4 12.5l5 5L20 6.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex size-4 items-center justify-center">
      <motion.span
        className="absolute size-3 rounded-full bg-indigo-500/40"
        animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="size-1.5 rounded-full bg-indigo-400" />
    </span>
  );
}

function BlinkingCursor() {
  return (
    <motion.span
      className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-indigo-400"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
    />
  );
}

export type StepState = "pending" | "active" | "done";

export function ProcessingStepList({
  steps,
  states,
}: {
  steps: readonly string[];
  states: StepState[];
}) {
  return (
    <div className="flex flex-col gap-3 font-mono text-sm">
      {steps.map((label, i) => {
        const state = states[i] ?? "pending";
        if (state === "pending") return null;
        return (
          <motion.div
            key={label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="flex items-center gap-3"
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              {state === "done" ? <AnimatedCheck className="size-4" /> : <PulsingDot />}
            </span>
            <span
              className={
                state === "done"
                  ? "text-muted-foreground"
                  : "text-indigo-700 dark:text-indigo-300"
              }
            >
              {label}
              {state === "active" && <BlinkingCursor />}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

export function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className="h-full rounded-full bg-indigo-500 shadow-[0_0_8px_rgb(99_102_241/0.6)]"
        animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}
