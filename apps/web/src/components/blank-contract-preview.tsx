"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { useQuery } from "convex/react";
import { DownloadIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type BlankContract =
  | { kind: "template"; key: string }
  | { kind: "custom"; id: Id<"customDocuments">; name: string };

export function BlankContractPreview({
  contract,
  onClose,
}: {
  contract: BlankContract;
  onClose: () => void;
}) {
  const templateUrl = useQuery(api.templates.getTemplateUrl,
    contract.kind === "template" ? { key: contract.key } : "skip");
  const customUrl = useQuery(api.customDocuments.getCustomDocumentUrl,
    contract.kind === "custom" ? { id: contract.id } : "skip");
  const url = contract.kind === "template" ? templateUrl : customUrl;
  const name = contract.kind === "template" ? contract.key : contract.name;
  const filename = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreviewUrl(null);
    setError(null);
    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load the blank contract.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        // Keep the original bytes and form fields, even if upload metadata
        // omitted the PDF content type. Reuse this blob for the download.
        const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
        objectUrl = URL.createObjectURL(pdf);
        setPreviewUrl(objectUrl);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Could not load the blank contract.");
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  const message = url === null ? "This contract file is no longer available." : error;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
      className="m-auto h-[90dvh] max-h-[90dvh] w-[94vw] max-w-6xl rounded-lg border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">Blank contract</h2>
            <p className="truncate text-xs text-muted-foreground" title={filename}>{filename}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close contract preview" autoFocus onClick={() => dialogRef.current?.close()}>
            <XIcon className="size-4" />
          </Button>
        </div>
        {message ? (
          <p role="alert" className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">{message}</p>
        ) : previewUrl ? (
          <iframe title={`Blank contract: ${filename}`} src={previewUrl} className="min-h-0 w-full flex-1 bg-white" />
        ) : (
          <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading blank contract...
          </div>
        )}
        <div className="flex justify-end border-t border-border px-4 py-3">
          {previewUrl && !message ? (
            <a href={previewUrl} download={filename} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <DownloadIcon data-icon="inline-start" />
              Download blank contract
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <DownloadIcon data-icon="inline-start" />
              Download blank contract
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
