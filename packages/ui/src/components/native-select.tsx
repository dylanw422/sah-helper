"use client";

import { cn } from "@sah-helper/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full min-w-0 appearance-none rounded-md border border-input bg-surface-sunken/60 px-2.5 py-1 pr-8 text-xs transition-[border-color,box-shadow] duration-150 outline-none focus-visible:border-ring/60 focus-visible:shadow-[0_0_0_3px_rgb(var(--accent-rgb)/0.10)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-background [&>option]:text-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
