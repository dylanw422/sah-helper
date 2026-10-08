"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Dimension } from "@/lib/floor-plan/dimensions";
import { dimensionEnds, type FixedDimensionEnd } from "@/lib/floor-plan/edit-dimension";
import { parseLengthInput } from "@/lib/floor-plan/length-input";
import { formatLength, type Point } from "@/lib/floor-plan/model";

export function DimensionInlineEditor({ dimension, anchor, size, fixed, onFixedChange, onApply, onCancel }: {
  dimension: Dimension; anchor: Point; size: { width: number; height: number }; fixed: FixedDimensionEnd;
  onFixedChange: (end: FixedDimensionEnd) => void; onApply: (inches: number) => void; onCancel: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLFormElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(formatLength(dimension.value).replace("′", "'").replace("″", '"'));
  const [error, setError] = useState(""), [height, setHeight] = useState(36);
  const hintId = useId(), errorId = useId();
  const ends = dimensionEnds(dimension);
  const horizontal = Math.abs(ends.end.x - ends.start.x) >= Math.abs(ends.end.y - ends.start.y);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (ref.current) setHeight(ref.current.getBoundingClientRect().height); });
    if (ref.current) observer.observe(ref.current);
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-dimension]")) return;
      if (!ref.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("pointerdown", outside);
    return () => { observer.disconnect(); document.removeEventListener("pointerdown", outside); };
  }, [onCancel]);
  const width = Math.min(186, Math.max(0, size.width - 16));
  return <form ref={ref} className="fp-dimension-editor" role="group" aria-label="Edit dimension" style={{ width, left: Math.max(8, Math.min(size.width - width - 8, anchor.x - width / 2)), top: Math.max(26, Math.min(size.height - height - 12, anchor.y - 17)) }}
    onPointerDown={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onCancel(true); } else if (e.key === "Enter") { e.preventDefault(); ref.current?.requestSubmit(); } }}
    onSubmit={e => {
      e.preventDefault(); setError("");
      try { onApply(parseLengthInput(value)); }
      catch (e) { setError(e instanceof Error ? e.message : "This dimension could not be adjusted."); inputRef.current?.focus(); }
    }}>
    <div className="fp-dimension-entry">
      <button type="button" aria-label={`Move ${horizontal ? "left" : "top"} end`} aria-pressed={fixed === "end"} title={`Move ${horizontal ? "left" : "top"} end`} onPointerDown={e => e.preventDefault()} onClick={() => { onFixedChange("end"); inputRef.current?.focus(); }}>{horizontal ? <ArrowLeft size={15} /> : <ArrowUp size={15} />}</button>
      <input ref={inputRef} aria-label="New dimension" aria-invalid={!!error} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} title="Numbers default to feet. Use a double quote for inches. Enter to apply; Escape to cancel." value={value} onChange={e => { setValue(e.target.value); setError(""); }} autoComplete="off" spellCheck={false} maxLength={80} />
      <button type="button" aria-label={`Move ${horizontal ? "right" : "bottom"} end`} aria-pressed={fixed === "start"} title={`Move ${horizontal ? "right" : "bottom"} end`} onPointerDown={e => e.preventDefault()} onClick={() => { onFixedChange("start"); inputRef.current?.focus(); }}>{horizontal ? <ArrowRight size={15} /> : <ArrowDown size={15} />}</button>
    </div>
    <span id={hintId} hidden>Numbers default to feet. Use a double quote for inches, or an apostrophe and double quote for feet and inches. The highlighted arrow shows which end moves. Enter to apply; Escape to cancel.</span>
    {error ? <p id={errorId} className="fp-form-error" role="alert">{error}</p> : null}
  </form>;
}
