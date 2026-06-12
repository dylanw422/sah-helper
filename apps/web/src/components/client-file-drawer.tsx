"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useConvex, useMutation, useQuery } from "convex/react";
import { DownloadIcon, FileTextIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FileDropZone } from "@/components/file-drop-zone";
import { downloadFile } from "@/lib/download";

export function ClientFileDrawer({ clientId }: { clientId: Id<"clients"> }) {
  const files = useQuery(api.clientFiles.listClientFiles, { clientId });

  if (files === undefined) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
      </div>
    );
  }

  return <ClientFileList clientId={clientId} files={files} />;
}

export function ClientFileList({
  clientId,
  files,
}: {
  clientId: Id<"clients">;
  files: Doc<"clientFiles">[];
}) {
  const generated = files.filter((f) => f.type === "generated");
  const uploaded = files.filter((f) => f.type === "uploaded");

  return (
    <div className="space-y-4">
      <FileSection title={`Generated (${generated.length})`} files={generated} />
      {uploaded.length > 0 && (
        <FileSection title={`Uploaded (${uploaded.length})`} files={uploaded} deletable />
      )}
      <FileDropZone clientId={clientId} />
    </div>
  );
}

function FileSection({
  title,
  files,
  deletable = false,
}: {
  title: string;
  files: Doc<"clientFiles">[];
  deletable?: boolean;
}) {
  if (files.length === 0) {
    return (
      <div>
        <SectionLabel>{title}</SectionLabel>
        <p className="px-1 text-xs text-muted-foreground/70">No files yet.</p>
      </div>
    );
  }
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="space-y-0.5">
        {files.map((file) => (
          <FileRow key={file._id} file={file} deletable={deletable} />
        ))}
      </ul>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-1 text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground/70">
      {children}
    </p>
  );
}

function FileRow({ file, deletable }: { file: Doc<"clientFiles">; deletable: boolean }) {
  const convex = useConvex();
  const deleteClientFile = useMutation(api.clientFiles.deleteClientFile);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = await convex.query(api.clientFiles.getFileDownloadUrl, { fileId: file._id });
      if (!url) throw new Error("File missing");
      await downloadFile(url, file.filename);
    } catch {
      toast.error(`Could not download ${file.filename}.`);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteClientFile({ fileId: file._id });
      toast.success(`Removed ${file.filename}.`);
    } catch {
      toast.error(`Could not remove ${file.filename}.`);
      setDeleting(false);
    }
  };

  return (
    <li className="group/file flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent/50">
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs">{file.filename}</span>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        title={`Download ${file.filename}`}
        className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {downloading ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <DownloadIcon className="size-3.5" />
        )}
      </button>
      {deletable && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          title={`Remove ${file.filename}`}
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
        >
          {deleting ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <Trash2Icon className="size-3.5" />
          )}
        </button>
      )}
    </li>
  );
}
