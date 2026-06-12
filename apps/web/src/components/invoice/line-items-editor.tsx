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

import { formatCurrency } from "@/lib/format";

export type LineItemRow = {
  id: string;
  description: string;
  qty: string;
  unitPrice: string;
};

export function createLineItemRow(): LineItemRow {
  return { id: crypto.randomUUID(), description: "", qty: "1", unitPrice: "0" };
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
  const total = rows.reduce((sum, row) => sum + lineItemRowAmount(row), 0);
  // The final draw is a 20% holdback of the contract total.
  const holdback = total * 0.2;

  const setRow = (id: string, patch: Partial<LineItemRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const moveRow = (id: string, dir: -1 | 1) => {
    const i = rows.findIndex((row) => row.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const copy = [...rows];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        List items in construction order (demo before install, etc.) — draws are split in this
        order. Drag the handle or use the arrows to reorder.
      </p>

      {rows.length > 10 && (
        <div className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
          Only the first 10 line items appear itemized on the contract templates.
        </div>
      )}

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

        <Reorder.Group axis="y" values={rows} onReorder={onChange} className="relative">
          {rows.map((row, i) => (
            <LineItemRowView
              key={row.id}
              row={row}
              index={i}
              count={rows.length}
              onPatch={(patch) => setRow(row.id, patch)}
              onMove={(dir) => moveRow(row.id, dir)}
              onDelete={() => onChange(rows.filter((r) => r.id !== row.id))}
            />
          ))}
        </Reorder.Group>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, createLineItemRow()])}
      >
        <PlusIcon data-icon="inline-start" />
        Add Line Item
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
    </div>
  );
}

function LineItemRowView({
  row,
  index,
  count,
  onPatch,
  onMove,
  onDelete,
}: {
  row: LineItemRow;
  index: number;
  count: number;
  onPatch: (patch: Partial<LineItemRow>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const dragControls = useDragControls();

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
      <Input
        value={row.description}
        onChange={(e) => onPatch({ description: e.target.value })}
        placeholder="Description"
      />
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
