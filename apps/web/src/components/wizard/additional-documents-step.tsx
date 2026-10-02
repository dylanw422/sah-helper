"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { useQuery } from "convex/react";
import {
  ArrowRightIcon,
  CheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  FilesIcon,
  HouseIcon,
  Loader2Icon,
} from "lucide-react";
import { useState } from "react";

import { FileDropZone } from "@/components/file-drop-zone";

const SUGGESTED_DOCUMENTS = [
  { label: "House plans", icon: HouseIcon },
  { label: "Builder spec sheet", icon: ClipboardListIcon },
  { label: "Additional spec sheets", icon: FilesIcon },
] as const;

export function AdditionalDocumentsStep({
  clientId,
  clientName,
  finalizing,
  onContinue,
}: {
  clientId: Id<"clients">;
  clientName: string;
  finalizing: boolean;
  onContinue: () => void;
}) {
  const files = useQuery(api.clientFiles.listClientFiles, { clientId });
  const [uploading, setUploading] = useState(false);
  const uploaded = files?.filter((file) => file.type === "uploaded") ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl pt-4">
      <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-indigo-600 uppercase dark:text-indigo-400">
        Before download
      </p>
      <h1 className="text-2xl font-semibold tracking-[-0.035em]">Add supporting documents</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Upload any documents needed for {clientName}&rsquo;s packet. Files added here will be
        included in the final PDF before you download it.
      </p>

      <p className="mt-6 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        Common additions
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {SUGGESTED_DOCUMENTS.map(({ label, icon: Icon }) => (
          <div key={label} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-3 text-xs font-medium">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400">
              <Icon className="size-4" />
            </span>
            {label}
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-border bg-card p-4 sm:p-5">
        <p className="mb-3 text-sm font-semibold">Upload files</p>
        <FileDropZone
          clientId={clientId}
          disabled={finalizing}
          onUploadingChange={setUploading}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          PDF, image, and text files are supported. You can add multiple files.
        </p>

        {uploaded.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Uploaded files ({uploaded.length})
            </p>
            <ul className="space-y-2">
              {uploaded.map((file) => (
                <li key={file._id} className="flex min-w-0 items-center gap-2.5 rounded-md bg-muted/50 px-3 py-2.5 text-xs">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                  <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Button
        size="lg"
        className="mt-6 w-full sm:w-auto"
        disabled={files === undefined || uploading || finalizing}
        onClick={onContinue}
      >
        {finalizing ? (
          <>
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
            Adding files to packet...
          </>
        ) : (
          <>
            Continue to download
            <ArrowRightIcon data-icon="inline-end" />
          </>
        )}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        No additional documents? Continue without uploading.
      </p>
    </div>
  );
}
