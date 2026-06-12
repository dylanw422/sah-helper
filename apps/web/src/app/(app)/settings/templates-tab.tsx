"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
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
import { useAction, useMutation, useQuery } from "convex/react";
import { ClipboardCopyIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { formatDate } from "@/lib/format";

type FieldInfo = { name: string; type: string };

export function TemplatesTab() {
  const templates = useQuery(api.templates.listTemplates);
  const generateUploadUrl = useMutation(api.templates.generateTemplateUploadUrl);
  const registerTemplate = useMutation(api.templates.registerTemplate);
  const inspectTemplate = useAction(api.templates.inspectTemplate);

  const [fields, setFields] = useState<Record<string, FieldInfo[]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKeyRef = useRef<string | null>(null);

  const handleUpload = async (key: string, file: File) => {
    setBusyKey(key);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = await res.json();
      await registerTemplate({ key, storageId });
      toast.success(`Uploaded ${key}`);
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

  const copyAll = () => {
    const output = Object.entries(fields)
      .map(
        ([key, list]) =>
          `// ${key}\n${list.map((f) => `//   ${f.name} (${f.type})`).join("\n")}`,
      )
      .join("\n\n");
    navigator.clipboard.writeText(output);
    toast.success("Copied field names to clipboard.");
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const key = pendingKeyRef.current;
          if (file && key) handleUpload(key, file);
          e.target.value = "";
        }}
      />

      <div className="mb-6 border border-border">
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
                      onClick={() => {
                        pendingKeyRef.current = t.key;
                        fileInputRef.current?.click();
                      }}
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
          </TableBody>
        </Table>
      </div>

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
            const fieldMap = templates?.find((t) => t.key === key)?.fieldMap ?? null;
            return (
              <div key={key} className="border border-border">
                <div className="border-b bg-card px-3 py-2 font-mono text-[11px] font-medium">
                  {key}.pdf — {list.length} fields
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
    </div>
  );
}
