"use client";

import { Button } from "@sah-helper/ui/components/button";
import { Label } from "@sah-helper/ui/components/label";
import { NativeSelect } from "@sah-helper/ui/components/native-select";
import { FileTextIcon, UploadCloudIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export type DrawCount = 4 | 5 | 6;

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
  initialFile,
  initialDrawCount,
}: {
  onSubmit: (file: File, drawCount: DrawCount) => void;
  initialFile?: File | null;
  initialDrawCount?: DrawCount | null;
}) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [drawCount, setDrawCount] = useState<DrawCount | null>(initialDrawCount ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setFile(f);
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">New Packet</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Upload an invoice PDF and select the number of draws for this job.
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

        {file ? (
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

      <div className="mt-6 space-y-2">
        <Label htmlFor="draw-count">Draw Count</Label>
        <NativeSelect
          id="draw-count"
          value={drawCount ?? ""}
          onChange={(e) => setDrawCount(Number(e.target.value) as DrawCount)}
        >
          <option value="" disabled>
            Select draw count...
          </option>
          <option value="4">4 Draws</option>
          <option value="5">5 Draws</option>
          <option value="6">6 Draws</option>
        </NativeSelect>
      </div>

      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={!file || !drawCount}
        onClick={() => file && drawCount && onSubmit(file, drawCount)}
      >
        Process Invoice
      </Button>
    </div>
  );
}
