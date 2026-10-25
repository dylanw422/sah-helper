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
import { BlankContractPreview, type BlankContract } from "@/components/blank-contract-preview";
import { formatDate } from "@/lib/format";
import { TEMPLATE_DISPLAY_NAMES } from "@sah-helper/backend/convex/lib/templateNames";
import { STANDARD_PACKET_DOCUMENTS, type StandardPacketDocumentKey } from "@sah-helper/backend/convex/lib/templateKeys";

type FieldInfo = { name: string; type: string };
type Category = "contract" | "packet-document" | "waiver" | "spec-sheet" | "job-specific";
type PendingUpload = { kind: "slot"; key: string } | { kind: "custom"; category: Category };

const ADD_LABELS: Record<Category, string> = {
  contract: "Add Contract",
  "packet-document": "Add Document",
  waiver: "Add Waiver",
  "spec-sheet": "Add Spec Sheet",
  "job-specific": "Add Job-Specific Document",
};

export function TemplatesTab() {
  const convex = useConvex();
  const templates = useQuery(api.templates.listTemplates);
  const customDocs = useQuery(api.customDocuments.listCustomDocuments, {});
  const excludedDocuments = useQuery(api.settings.getExcludedPacketDocuments);
  const setPacketDocumentIncluded = useMutation(api.settings.setPacketDocumentIncluded);
  const generateUploadUrl = useMutation(api.templates.generateTemplateUploadUrl);
  const registerTemplate = useMutation(api.templates.registerTemplate);
  const registerCustomDocument = useMutation(api.customDocuments.registerCustomDocument);
  const deleteCustomDocument = useMutation(api.customDocuments.deleteCustomDocument);
  const inspectTemplate = useAction(api.templates.inspectTemplate);
  const inspectCustomDocument = useAction(api.customDocuments.inspectCustomDocument);

  const [fields, setFields] = useState<Record<string, FieldInfo[]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Doc<"customDocuments"> | null>(null);
  const [pendingStandardDelete, setPendingStandardDelete] = useState<(typeof STANDARD_PACKET_DOCUMENTS)[number] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewContract, setPreviewContract] = useState<BlankContract | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingUpload | null>(null);

  const customContracts = (customDocs ?? []).filter((d) => d.category === "contract");
  const standardDocuments = (customDocs ?? []).filter((d) => d.category === "packet-document");
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
    if (!pendingDelete || deleting) return;
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

  const changeStandardDocument = async (key: StandardPacketDocumentKey, included: boolean) => {
    if (busyKey !== null) return;
    setBusyKey(`standard:${key}`);
    try {
      await setPacketDocumentIncluded({ key, included });
      setPendingStandardDelete(null);
      toast.success(included ? "Document added to future packets." : "Document removed from future packets.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update packet documents.");
    } finally {
      setBusyKey(null);
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
    <div className="flex justify-end border-t border-border bg-surface-overlay/40 px-4 py-3">
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

  const sharedSection = (title: string, docs: Doc<"customDocuments">[], category: Category) => (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shared across workspaces. Deleting a document removes it for everyone.
        </p>
      </div>
      <div>
        {docs.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No {title.toLowerCase()} uploaded yet.
          </p>
        ) : (
          <Table className="min-w-[560px]">
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
                        title={`Delete ${doc.displayName}`}
                        disabled={busyKey !== null || deleting}
                        onClick={() => setPendingDelete(doc)}
                      >
                        <Trash2Icon data-icon="inline-start" className="text-destructive" />
                        Delete
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
    </section>
  );

  const templateRow = (t: NonNullable<typeof templates>[number]) => (
    <TableRow key={t.key}>
      <TableCell className="text-xs">{TEMPLATE_DISPLAY_NAMES[t.key]}</TableCell>
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
            disabled={!t.uploaded || busyKey !== null}
            aria-label={`View blank ${t.key}`}
            onClick={() => setPreviewContract({ kind: "template", key: t.key })}
          >
            <EyeIcon data-icon="inline-start" />
            View
          </Button>
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
  );

  return (
    <div className="space-y-5">
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

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold">Contracts</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage construction contracts and any custom contracts included in every packet. Use View to download a blank copy.
          </p>
        </div>
        <div>
          <Table className="min-w-[650px]">
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(templates ?? []).filter(t => t.key.startsWith("construction-contract-")).map(templateRow)}
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
                        aria-label={`View blank ${doc.displayName}`}
                        onClick={() => setPreviewContract({ kind: "custom", id: doc._id, name: doc.displayName })}
                      >
                        <EyeIcon data-icon="inline-start" />
                        View
                      </Button>
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
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold">Standard packet documents</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add or remove documents included in every new packet for your workspace. Existing packets keep their copies.
          </p>
        </div>
        <Table className="min-w-[650px]">
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Included</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STANDARD_PACKET_DOCUMENTS.filter(doc => !excludedDocuments?.includes(doc.key)).map(doc => (
              <TableRow key={doc.key}>
                <TableCell className="text-xs font-medium">{doc.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{doc.detail}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="xs" aria-label={`Delete ${doc.name}`}
                    disabled={excludedDocuments === undefined || busyKey !== null || deleting}
                    onClick={() => setPendingStandardDelete(doc)}>
                    <Trash2Icon data-icon="inline-start" className="text-destructive" />
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {standardDocuments.map(doc => (
              <TableRow key={doc._id}>
                <TableCell className="text-xs font-medium">{doc.displayName}.pdf</TableCell>
                <TableCell className="text-xs text-muted-foreground">Every packet · {formatDate(doc.uploadedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="xs" aria-label={`Delete ${doc.displayName}`}
                    disabled={busyKey !== null || deleting} onClick={() => setPendingDelete(doc)}>
                    <Trash2Icon data-icon="inline-start" className="text-destructive" />
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {excludedDocuments?.length === STANDARD_PACKET_DOCUMENTS.length && standardDocuments.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-5 text-xs text-muted-foreground">No standard documents included. Add a document below.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface-overlay/40 px-4 py-3">
          {!!excludedDocuments?.length && (
            <select aria-label="Add a built-in packet document" value="" disabled={busyKey !== null || deleting}
              className="h-7 max-w-full rounded-md border border-border bg-background px-2 text-xs"
              onChange={event => { if (event.target.value) void changeStandardDocument(event.target.value as StandardPacketDocumentKey, true); }}>
              <option value="" disabled>Add a built-in document...</option>
              {STANDARD_PACKET_DOCUMENTS.filter(doc => excludedDocuments.includes(doc.key)).map(doc => (
                <option key={doc.key} value={doc.key}>{doc.name}</option>
              ))}
            </select>
          )}
          <Button variant="outline" size="xs" disabled={busyKey !== null || deleting}
            onClick={() => triggerFilePicker({ kind: "custom", category: "packet-document" })}>
            <UploadIcon data-icon="inline-start" />
            {busyKey === "add:packet-document" ? "Uploading..." : "Add Document"}
          </Button>
        </div>
      </section>

      {sharedSection("Waivers", waivers, "waiver")}
      {sharedSection("Spec Sheets", specSheets, "spec-sheet")}
      {sharedSection("Job-Specific Documents", jobSpecificDocs, "job-specific")}

      {Object.keys(fields).length > 0 && (
        <div className="space-y-4 pt-2">
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
              <div key={key} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                <div className="border-b border-border px-5 py-3 font-mono text-xs font-medium">
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

      {previewContract && (
        <BlankContractPreview
          contract={previewContract}
          onClose={() => setPreviewContract(null)}
        />
      )}

      <ConfirmDialog
        open={pendingStandardDelete !== null}
        title={`Delete ${pendingStandardDelete?.name ?? "this document"}?`}
        description="This removes the document from future packets for your workspace. Existing packets keep their copies. You can add it back in this section."
        confirmLabel="Delete"
        confirming={busyKey !== null}
        onConfirm={() => { if (pendingStandardDelete) void changeStandardDocument(pendingStandardDelete.key, false); }}
        onCancel={() => { if (busyKey === null) setPendingStandardDelete(null); }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.displayName ?? "this document"}?`}
        description={pendingDelete?.category === "contract" || pendingDelete?.category === "packet-document"
          ? "The file is removed from the library. Packets that were already generated keep their own copy."
          : "The file is removed from the shared library for all workspaces. Packets that were already generated keep their own copy."}
        confirmLabel="Delete"
        confirming={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
