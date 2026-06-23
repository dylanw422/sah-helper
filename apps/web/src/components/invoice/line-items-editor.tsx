"use client";

import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { formatCurrency } from "@/lib/format";

export type LineItemRow = {
  id: string;
  description: string;
  qty: string;
  unitPrice: string;
  isEstimate?: boolean;
};

export const PROFIT_DESCRIPTION = "Profit";

export function createLineItemRow(): LineItemRow {
  return { id: crypto.randomUUID(), description: "", qty: "1", unitPrice: "0" };
}

export function createProfitRow(): LineItemRow {
  return { id: crypto.randomUUID(), description: PROFIT_DESCRIPTION, qty: "20", unitPrice: "0" };
}

export function lineItemRowAmount(row: LineItemRow): number {
  const qty = parseFloat(row.qty) || 0;
  const unitPrice = parseFloat(row.unitPrice) || 0;
  return qty * unitPrice;
}

const GRID_COLS =
  "grid grid-cols-[28px_minmax(0,1fr)_64px_104px_96px_84px] items-center gap-x-2";

export function LineItemsEditor({
  rows,
  onChange,
}: {
  rows: LineItemRow[];
  onChange: (rows: LineItemRow[]) => void;
}) {
  // Last row is always the profit percentage row.
  const regularRows = rows.slice(0, -1);
  const profitRow = rows[rows.length - 1]!;
  const regularSubtotal = regularRows.reduce((sum, row) => sum + lineItemRowAmount(row), 0);
  const profitPct = parseFloat(profitRow.qty) || 0;
  const profitAmount = regularSubtotal * (profitPct / 100);
  const total = regularSubtotal + profitAmount;

  // ID of the row whose description input should receive focus on next render.
  const [focusId, setFocusId] = useState<string | null>(null);

  const setRow = (id: string, patch: Partial<LineItemRow>) =>
    // Editing any field clears the estimate flag for that row.
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch, isEstimate: undefined } : row)));

  const moveRow = (id: string, dir: -1 | 1) => {
    const i = regularRows.findIndex((row) => row.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= regularRows.length) return;
    const copy = [...regularRows];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange([...copy, profitRow]);
  };

  const addRow = () => {
    const row = createLineItemRow();
    onChange([...regularRows, row, profitRow]);
    setFocusId(row.id);
  };

  const handleReorder = (reordered: LineItemRow[]) => {
    onChange([...reordered, profitRow]);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        List items in construction order (demo before install, etc.) — draws are split in this
        order. Drag the handle or use the arrows to reorder.
      </p>

      <div className="text-xs">
        <div
          className={`${GRID_COLS} h-9 border-b font-medium whitespace-nowrap text-muted-foreground`}
        >
          <span />
          <span className="px-1">Description</span>
          <span className="px-1">Qty</span>
          <span className="px-1">Unit Price</span>
          <span className="px-1 text-right">Amount</span>
          <span />
        </div>

        <Reorder.Group axis="y" values={regularRows} onReorder={handleReorder} className="relative">
          {regularRows.map((row, i) => (
            <LineItemRowView
              key={row.id}
              row={row}
              index={i}
              count={regularRows.length}
              focusDescription={focusId === row.id}
              onFocused={() => setFocusId(null)}
              onPatch={(patch) => setRow(row.id, patch)}
              onMove={(dir) => moveRow(row.id, dir)}
              onDelete={() => onChange([...regularRows.filter((r) => r.id !== row.id), profitRow])}
              onAddRow={addRow}
            />
          ))}
        </Reorder.Group>

        {/* Profit row — always last, pinned */}
        <div className={`${GRID_COLS} border-t bg-muted/30 py-2`}>
          <span />
          <span className="px-1 font-medium text-foreground">{PROFIT_DESCRIPTION}</span>
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              value={profitRow.qty}
              onChange={(e) => setRow(profitRow.id, { qty: e.target.value })}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              %
            </span>
          </div>
          <span className="px-1 text-muted-foreground/50">—</span>
          <span className="px-1 text-right font-mono tabular-nums">
            {formatCurrency(profitAmount)}
          </span>
          <span />
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={addRow}>
        <PlusIcon data-icon="inline-start" />
        Add Line Item
      </Button>

      <div className="flex flex-col items-end gap-1 border-t pt-3 text-xs">
        <div className="flex w-56 justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-mono tabular-nums">{formatCurrency(regularSubtotal)}</span>
        </div>
        <div className="flex w-56 justify-between text-muted-foreground">
          <span>Profit ({profitPct}%)</span>
          <span className="font-mono tabular-nums">{formatCurrency(profitAmount)}</span>
        </div>
<div className="flex w-56 justify-between text-sm font-semibold">
          <span>Total</span>
          <span className="font-mono tabular-nums">{formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  );
}

function LineItemRowView({
  row,
  index,
  count,
  focusDescription,
  onFocused,
  onPatch,
  onMove,
  onDelete,
  onAddRow,
}: {
  row: LineItemRow;
  index: number;
  count: number;
  focusDescription: boolean;
  onFocused: () => void;
  onPatch: (patch: Partial<Omit<LineItemRow, "isEstimate">>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAddRow: () => void;
}) {
  const dragControls = useDragControls();
  const descriptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusDescription) {
      descriptionRef.current?.focus();
      onFocused();
    }
  }, [focusDescription, onFocused]);

  return (
    <Reorder.Item
      value={row}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={{
        scale: 1.01,
        boxShadow: "0 8px 24px -8px rgb(0 0 0 / 0.35)",
        zIndex: 10,
        position: "relative",
      }}
      className={`${GRID_COLS} border-b bg-card py-2 transition-colors last:border-0 hover:bg-muted/50`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(e) => {
          e.preventDefault();
          dragControls.start(e);
        }}
        className="flex h-8 cursor-grab touch-none items-center justify-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <div className="relative flex items-center">
        <Input
          ref={descriptionRef}
          value={row.description}
          onChange={(e) => {
            const v = e.target.value;
            onPatch({ description: v.length > 0 ? v[0]!.toUpperCase() + v.slice(1) : v });
          }}
          placeholder="Description"
          className={row.isEstimate ? "pr-12" : undefined}
        />
        {row.isEstimate && (
          <span className="pointer-events-none absolute right-1.5 rounded-sm bg-amber-500/15 px-1 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
            est.
          </span>
        )}
      </div>
      <Input
        type="number"
        inputMode="decimal"
        value={row.qty}
        onChange={(e) => onPatch({ qty: e.target.value })}
      />
      <Input
        type="number"
        inputMode="decimal"
        value={row.unitPrice}
        onChange={(e) => onPatch({ unitPrice: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAddRow();
          }
        }}
      />
      <span className="px-1 text-right font-mono tabular-nums">
        {formatCurrency(lineItemRowAmount(row))}
      </span>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move row up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move row down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete row" onClick={onDelete}>
          <Trash2Icon className="size-3.5 text-destructive" />
        </Button>
      </div>
    </Reorder.Item>
  );
}
