"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Badge } from "@sah-helper/ui/components/badge";
import { Button } from "@sah-helper/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sah-helper/ui/components/table";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { ClipboardCopyIcon, EyeIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/format";

type FieldInfo = { name: string; type: string };
type Category = "contract" | "waiver" | "spec-sheet" | "job-specific";
type PendingUpload = { kind: "slot"; key: string } | { kind: "custom"; category: Category };

const ADD_LABELS: Record<Category, string> = {
  contract: "Add Contract",
  waiver: "Add Waiver",
  "spec-sheet": "Add Spec Sheet",
  "job-specific": "Add Job-Specific Document",
};

export function TemplatesTab() {
  const convex = useConvex();
  const templates = useQuery(api.templates.listTemplates);
  const customDocs = useQuery(api.customDocuments.listCustomDocuments, {});
  const generateUploadUrl = useMutation(api.templates.generateTemplateUploadUrl);
  const registerTemplate = useMutation(api.templates.registerTemplate);
  const registerCustomDocument = useMutation(api.customDocuments.registerCustomDocument);
  const deleteCustomDocument = useMutation(api.customDocuments.deleteCustomDocument);
  const inspectTemplate = useAction(api.templates.inspectTemplate);
  const inspectCustomDocument = useAction(api.customDocuments.inspectCustomDocument);

  const [fields, setFields] = useState<Record<string, FieldInfo[]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Doc<"customDocuments"> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingUpload | null>(null);

  const customContracts = (customDocs ?? []).filter((d) => d.category === "contract");
  const waivers = (customDocs ?? []).filter((d) => d.category === "waiver");
  const specSheets = (customDocs ?? []).filter((d) => d.category === "spec-sheet");
  const jobSpecificDocs = (customDocs ?? []).filter((d) => d.category === "job-specific");

  const uploadFile = async (file: File): Promise<Id<"_storage">> => {
    const uploadUrl = await generateUploadUrl();
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    if (!res.ok) throw new Error("Upload failed");
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return storageId;
  };

  const handleUploadSlot = async (key: string, file: File) => {
    setBusyKey(key);
    try {
      const storageId = await uploadFile(file);
      await registerTemplate({ key, storageId });
      toast.success(`Uploaded ${key}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyKey(null);
    }
  };

  const handleUploadCustom = async (category: Category, file: File) => {
    setBusyKey(`add:${category}`);
    try {
      const storageId = await uploadFile(file);
      await registerCustomDocument({
        category,
        displayName: file.name.replace(/\.pdf$/i, ""),
        storageId,
      });
      toast.success(`Uploaded ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyKey(null);
    }
  };

  const handleInspect = async (key: string) => {
    setBusyKey(key);
    try {
      const result = await inspectTemplate({ key });
      setFields((f) => ({ ...f, [key]: result }));
      if (result.length === 0) {
        toast.warning(`${key} has no AcroForm fields.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Inspection failed");
    } finally {
      setBusyKey(null);
    }
  };

  const handleInspectCustom = async (doc: Doc<"customDocuments">) => {
    const stateKey = `custom:${doc._id}`;
    setBusyKey(stateKey);
    try {
      const result = await inspectCustomDocument({ id: doc._id });
      setFields((f) => ({ ...f, [stateKey]: result }));
      if (result.length === 0) {
        toast.warning(`${doc.displayName} has no AcroForm fields.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Inspection failed");
    } finally {
      setBusyKey(null);
    }
  };

  const handleView = async (doc: Doc<"customDocuments">) => {
    try {
      const url = await convex.query(api.customDocuments.getCustomDocumentUrl, { id: doc._id });
      if (!url) throw new Error("File not found.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open file");
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteCustomDocument({ id: pendingDelete._id });
      setFields((f) => {
        const { [`custom:${pendingDelete._id}`]: _removed, ...rest } = f;
        return rest;
      });
      toast.success(`Deleted ${pendingDelete.displayName}`);
      setPendingDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const triggerFilePicker = (pending: PendingUpload) => {
    pendingRef.current = pending;
    fileInputRef.current?.click();
  };

  const displayNameFor = (stateKey: string): string => {
    if (stateKey.startsWith("custom:")) {
      const doc = customDocs?.find((d) => `custom:${d._id}` === stateKey);
      return `${doc?.displayName ?? "Deleted document"}.pdf`;
    }
    return `${stateKey}.pdf`;
  };

  const fieldMapFor = (stateKey: string): Record<string, string> | null => {
    if (stateKey.startsWith("custom:")) {
      return customDocs?.find((d) => `custom:${d._id}` === stateKey)?.fieldMap ?? null;
    }
    return templates?.find((t) => t.key === stateKey)?.fieldMap ?? null;
  };

  const copyAll = () => {
    const output = Object.entries(fields)
      .map(
        ([key, list]) =>
          `// ${displayNameFor(key)}\n${list.map((f) => `//   ${f.name} (${f.type})`).join("\n")}`,
      )
      .join("\n\n");
    navigator.clipboard.writeText(output);
    toast.success("Copied field names to clipboard.");
  };

  const addButton = (category: Category) => (
    <div className="flex justify-end border-t border-border px-3 py-2">
      <Button
        variant="outline"
        size="xs"
        disabled={busyKey !== null}
        onClick={() => triggerFilePicker({ kind: "custom", category })}
      >
        <UploadIcon data-icon="inline-start" />
        {busyKey === `add:${category}` ? "Uploading..." : ADD_LABELS[category]}
      </Button>
    </div>
  );

  const mappingBadge = (doc: Doc<"customDocuments">) =>
    doc.fieldMap ? (
      <Badge variant="green">
        Mapped {Object.keys(doc.fieldMap).length} fields · {formatDate(doc.uploadedAt)}
      </Badge>
    ) : (
      <Badge variant="amber">Mapping fields…</Badge>
    );

  const immutableSection = (title: string, docs: Doc<"customDocuments">[], category: Category) => (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="border border-border">
        {docs.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No {title.toLowerCase()} uploaded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc._id}>
                  <TableCell className="font-mono text-[11px]">{doc.displayName}.pdf</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(doc.uploadedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="xs" onClick={() => handleView(doc)}>
                        <EyeIcon data-icon="inline-start" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        aria-label={`Delete ${doc.displayName}`}
                        disabled={busyKey !== null}
                        onClick={() => setPendingDelete(doc)}
                      >
                        <Trash2Icon className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {addButton(category)}
      </div>
    </div>
  );

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const pending = pendingRef.current;
          if (file && pending) {
            if (pending.kind === "slot") handleUploadSlot(pending.key, file);
            else handleUploadCustom(pending.category, file);
          }
          e.target.value = "";
        }}
      />

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Contracts</h2>
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(templates ?? []).map((t) => (
                <TableRow key={t.key}>
                  <TableCell className="font-mono text-[11px]">{t.key}.pdf</TableCell>
                  <TableCell>
                    {!t.uploaded ? (
                      <Badge variant="amber">Missing</Badge>
                    ) : t.fieldMap ? (
                      <Badge variant="green">
                        Mapped {Object.keys(t.fieldMap).length} fields
                        {t.uploadedAt ? ` · ${formatDate(t.uploadedAt)}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="amber">Mapping fields…</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busyKey !== null}
                        onClick={() => triggerFilePicker({ kind: "slot", key: t.key })}
                      >
                        <UploadIcon data-icon="inline-start" />
                        {t.uploaded ? "Replace" : "Upload"}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!t.uploaded || busyKey !== null}
                        onClick={() => handleInspect(t.key)}
                      >
                        <SearchIcon data-icon="inline-start" />
                        {busyKey === t.key ? "Working..." : "Inspect"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {customContracts.map((doc) => (
                <TableRow key={doc._id}>
                  <TableCell className="font-mono text-[11px]">{doc.displayName}.pdf</TableCell>
                  <TableCell>{mappingBadge(doc)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busyKey !== null}
                        onClick={() => handleInspectCustom(doc)}
                      >
                        <SearchIcon data-icon="inline-start" />
                        {busyKey === `custom:${doc._id}` ? "Working..." : "Inspect"}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        aria-label={`Delete ${doc.displayName}`}
                        disabled={busyKey !== null}
                        onClick={() => setPendingDelete(doc)}
                      >
                        <Trash2Icon className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {addButton("contract")}
        </div>
      </div>

      {immutableSection("Waivers", waivers, "waiver")}
      {immutableSection("Spec Sheets", specSheets, "spec-sheet")}
      {immutableSection("Job-Specific Documents", jobSpecificDocs, "job-specific")}

      {Object.keys(fields).length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Enumerated Fields</h2>
            <Button variant="outline" size="sm" onClick={copyAll}>
              <ClipboardCopyIcon data-icon="inline-start" />
              Copy All
            </Button>
          </div>
          {Object.entries(fields).map(([key, list]) => {
            const fieldMap = fieldMapFor(key);
            return (
              <div key={key} className="border border-border">
                <div className="border-b bg-card px-3 py-2 font-mono text-[11px] font-medium">
                  {displayNameFor(key)} — {list.length} fields
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field Name</TableHead>
                      <TableHead>Field Type</TableHead>
                      <TableHead>Fills With</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="font-mono text-[11px]">{f.name}</TableCell>
                        <TableCell className="text-muted-foreground">{f.type}</TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {fieldMap?.[f.name] ?? (
                            <span className="text-muted-foreground">— (left blank for pen)</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.displayName ?? "this document"}?`}
        description="The file is removed from the library. Packets that were already generated keep their own copy."
        confirmLabel="Delete"
        confirming={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
