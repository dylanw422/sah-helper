"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc, Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sah-helper/ui/components/card";
import { Checkbox } from "@sah-helper/ui/components/checkbox";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sah-helper/ui/components/table";
import { useQuery } from "convex/react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { formatCurrency } from "@/lib/format";

import type { DrawCount } from "./draw-count-select";

export type VerifiedLineItem = {
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type VerifiedData = {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  invoiceNumber: string;
  caseNumber: string;
  lineItems: VerifiedLineItem[];
  // Library documents the user checked on the Verify step. Optional so flows
  // that construct VerifiedData before that step can omit them.
  waiverIds?: Id<"customDocuments">[];
  specSheetIds?: Id<"customDocuments">[];
};

type EditableLineItem = {
  description: string;
  qty: string;
  unitPrice: string;
};

// Must match isProfitItem in the backend's drawSchedule.ts.
function isProfitRow(row: { description: string }): boolean {
  return /profit/i.test(row.description);
}

function rowAmount(row: EditableLineItem): number {
  const qty = parseFloat(row.qty) || 0;
  const unitPrice = parseFloat(row.unitPrice) || 0;
  return qty * unitPrice;
}

export function VerifyStep({
  initial,
  drawCount,
  totalMismatchWarning,
  onBack,
  onGenerate,
}: {
  initial: VerifiedData;
  drawCount: DrawCount;
  totalMismatchWarning: boolean;
  onBack: () => void;
  onGenerate: (data: VerifiedData) => void;
}) {
  const [fields, setFields] = useState({
    name: initial.name,
    street: initial.street,
    city: initial.city,
    state: initial.state,
    zip: initial.zip,
    phone: initial.phone,
    invoiceNumber: initial.invoiceNumber,
    caseNumber: initial.caseNumber,
  });
  const [rows, setRows] = useState<EditableLineItem[]>(
    initial.lineItems.map((item) => ({
      description: item.description,
      qty: String(item.qty),
      unitPrice: String(item.unitPrice),
    })),
  );
  const customDocs = useQuery(api.customDocuments.listCustomDocuments, {});
  const waivers = (customDocs ?? []).filter((d) => d.category === "waiver");
  const specSheets = (customDocs ?? []).filter((d) => d.category === "spec-sheet");
  const [selectedWaivers, setSelectedWaivers] = useState<Set<Id<"customDocuments">>>(new Set());
  const [selectedSpecSheets, setSelectedSpecSheets] = useState<Set<Id<"customDocuments">>>(
    new Set(),
  );

  // Profit rows store a percentage in qty; their amount derives from the
  // subtotal of the regular rows rather than qty * unitPrice.
  const regularSubtotal = rows.reduce(
    (sum, row) => (isProfitRow(row) ? sum : sum + rowAmount(row)),
    0,
  );
  const amountFor = (row: EditableLineItem): number =>
    isProfitRow(row) ? regularSubtotal * ((parseFloat(row.qty) || 0) / 100) : rowAmount(row);
  const total = rows.reduce((sum, row) => sum + amountFor(row), 0);
  // The final draw is a 20% holdback of the contract total.
  const holdback = total * 0.2;

  const setField = (key: keyof typeof fields, value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  const setRow = (i: number, key: keyof EditableLineItem, value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));

  const moveRow = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const canGenerate =
    fields.name.trim() !== "" &&
    fields.street.trim() !== "" &&
    fields.caseNumber.trim() !== "" &&
    rows.length > 0 &&
    rows.some((row) => row.description.trim() !== "");

  const handleGenerate = () => {
    onGenerate({
      ...fields,
      lineItems: rows
        .filter((row) => row.description.trim() !== "" || amountFor(row) > 0)
        .map((row) => ({
          description: row.description,
          qty: parseFloat(row.qty) || 0,
          unitPrice: parseFloat(row.unitPrice) || 0,
          amount: amountFor(row),
        })),
      // Ids in list order (upload order), not click order.
      waiverIds: waivers.filter((d) => selectedWaivers.has(d._id)).map((d) => d._id),
      specSheetIds: specSheets.filter((d) => selectedSpecSheets.has(d._id)).map((d) => d._id),
    });
  };

  const clientFields = [
    { key: "name", label: "Client Name" },
    { key: "street", label: "Street Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "Zip Code" },
    { key: "phone", label: "Phone Number" },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">Verify Extracted Data</h1>
      <p className="mb-6 text-xs text-muted-foreground">
        Review the data extracted from the invoice and correct any mistakes before generating the
        packet.
      </p>

      {totalMismatchWarning && (
        <div className="mb-4 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
          Heads up: the invoice total didn&apos;t match the sum of its line items. Double-check the
          line items below.
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Client Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {clientFields.map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`field-${key}`}>{label}</Label>
                  <Input
                    id={`field-${key}`}
                    value={fields[key]}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Total Contract Amount</Label>
                <Input value={formatCurrency(total)} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Draw Count</Label>
                <Input value={`${drawCount} Draws`} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-invoiceNumber">Invoice Number</Label>
                <Input
                  id="field-invoiceNumber"
                  value={fields.invoiceNumber}
                  onChange={(e) => setField("invoiceNumber", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-caseNumber">SAH Case Number (required)</Label>
                <Input
                  id="field-caseNumber"
                  value={fields.caseNumber}
                  onChange={(e) => setField("caseNumber", e.target.value)}
                  aria-invalid={fields.caseNumber.trim() === ""}
                  placeholder="Identification number from the invoice"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {waivers.length > 0 && (
          <DocumentSelectCard
            title="Waivers"
            docs={waivers}
            selected={selectedWaivers}
            onChange={setSelectedWaivers}
          />
        )}

        {specSheets.length > 0 && (
          <DocumentSelectCard
            title="Spec Sheets"
            docs={specSheets}
            selected={selectedSpecSheets}
            onChange={setSelectedSpecSheets}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>Line Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Items are listed in construction order (demo before install, etc.) and draws are
              split in this order. Use the arrows to fix the sequence if it looks wrong.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/2">Description</TableHead>
                  <TableHead className="w-20">Qty</TableHead>
                  <TableHead className="w-32">Unit Price</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">
                      <Input
                        value={row.description}
                        onChange={(e) => setRow(i, "description", e.target.value)}
                        placeholder="Description"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={row.qty}
                        onChange={(e) => setRow(i, "qty", e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={row.unitPrice}
                        onChange={(e) => setRow(i, "unitPrice", e.target.value)}
                        disabled={isProfitRow(row)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(amountFor(row))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Move row up"
                          disabled={i === 0}
                          onClick={() => moveRow(i, -1)}
                        >
                          <ArrowUpIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Move row down"
                          disabled={i === rows.length - 1}
                          onClick={() => moveRow(i, 1)}
                        >
                          <ArrowDownIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete row"
                          onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                        >
                          <Trash2Icon className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows((r) => [...r, { description: "", qty: "1", unitPrice: "0" }])}
            >
              <PlusIcon data-icon="inline-start" />
              Add Row
            </Button>

            <div className="flex flex-col items-end gap-1 border-t pt-3 text-xs">
              <div className="flex w-56 justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{formatCurrency(total)}</span>
              </div>
              <div className="flex w-56 justify-between text-muted-foreground">
                <span>Final Draw Holdback (20%)</span>
                <span className="font-mono tabular-nums">{formatCurrency(holdback)}</span>
              </div>
              <div className="flex w-56 justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="font-mono tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
        <Button size="lg" disabled={!canGenerate} onClick={handleGenerate}>
          Looks Good — Generate Packet
        </Button>
      </div>
    </div>
  );
}

function DocumentSelectCard({
  title,
  docs,
  selected,
  onChange,
}: {
  title: string;
  docs: Doc<"customDocuments">[];
  selected: Set<Id<"customDocuments">>;
  onChange: (next: Set<Id<"customDocuments">>) => void;
}) {
  const toggle = (id: Id<"customDocuments">, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Include these documents in the packet.
        </p>
        {docs.map((doc) => (
          <div key={doc._id} className="flex items-center gap-2">
            <Checkbox
              id={`doc-${doc._id}`}
              checked={selected.has(doc._id)}
              onCheckedChange={(checked) => toggle(doc._id, checked === true)}
            />
            <Label htmlFor={`doc-${doc._id}`} className="cursor-pointer font-normal">
              {doc.displayName}
            </Label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
