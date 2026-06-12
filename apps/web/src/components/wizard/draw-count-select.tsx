"use client";

import { NativeSelect } from "@sah-helper/ui/components/native-select";

export type DrawCount = 4 | 5 | 6;

export function DrawCountSelect({
  id = "draw-count",
  value,
  onChange,
}: {
  id?: string;
  value: DrawCount | null;
  onChange: (value: DrawCount) => void;
}) {
  return (
    <NativeSelect
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value) as DrawCount)}
    >
      <option value="" disabled>
        Select draw count...
      </option>
      <option value="4">4 Draws</option>
      <option value="5">5 Draws</option>
      <option value="6">6 Draws</option>
    </NativeSelect>
  );
}
