"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { convertToPdf, UnsupportedFileError } from "@/lib/convert-to-pdf";

export function FileDropZone({ clientId }: { clientId: Id<"clients"> }) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const addClientFile = useMutation(api.clientFiles.addClientFile);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setUploadingCount((c) => c + files.length);
    await Promise.all(
      files.map(async (file) => {
        try {
          const pdf = await convertToPdf(file);
          const uploadUrl = await generateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": pdf.type },
            body: pdf,
          });
          if (!res.ok) throw new Error("Upload failed");
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          await addClientFile({
            clientId,
            storageId,
            filename: pdf.name,
            type: "uploaded",
          });
        } catch (err) {
          toast.error(
            err instanceof UnsupportedFileError ? err.message : `Could not upload ${file.name}.`,
          );
        } finally {
          setUploadingCount((c) => c - 1);
        }
      }),
    );
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={`flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-xs transition-colors ${
        dragOver
          ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
          : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
      }`}
    >
      {uploadingCount > 0 ? (
        <>
          <Loader2Icon className="size-3.5 animate-spin" />
          Uploading {uploadingCount} file{uploadingCount === 1 ? "" : "s"}...
        </>
      ) : (
        <>
          <UploadIcon className="size-3.5" />
          Drop files here, or click to browse
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}
