"use client";

import { FieldButton } from "./field-button";
import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import { DownloadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function FieldFileViewer({ id, token, onClose }: { id: Id<"projectFiles">; token?: string; onClose: () => void }) {
  const readFile = useAction(api.field.readFile);
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<{ url: string; filename: string; contentType: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    void readFile({ id, token }).then(result => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.contentType }));
      setFile({ url: objectUrl, filename: result.filename, contentType: result.contentType });
    }).catch(() => { if (!disposed) setError("This file is no longer available, or your project access has changed."); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, token, readFile]);
  return <dialog ref={dialog} onClose={onClose} aria-label="Project file" className="fw-viewer">
    <div className="flex h-full flex-col">
      <div className="fw-viewer-head"><span className="min-w-0 truncate text-sm">{file?.filename ?? "Project file"}</span><FieldButton className="fw-button" aria-label="Close file" autoFocus onClick={() => dialog.current?.close()}><XIcon /></FieldButton></div>
      {error ? <p role="alert" className="p-8 text-sm">{error}</p> : !file ? <p role="status" className="p-8 text-sm">Loading file...</p> : file.contentType === "application/pdf"
        ? <iframe className="fw-viewer-media" src={file.url} title={file.filename} />
        : <img className="fw-viewer-media" src={file.url} alt={file.filename} />}
      {file && <div className="p-3"><a className="fw-button" href={file.url} download={file.filename}><DownloadIcon />Download file</a></div>}
    </div>
  </dialog>;
}
