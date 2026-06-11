import { cn } from "@sah-helper/ui/lib/utils";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full min-w-0 rounded-md border border-input bg-surface-sunken/60 px-2.5 py-2 text-xs transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:shadow-[0_0_0_3px_rgb(var(--accent-rgb)/0.10),inset_0_1px_2px_rgb(0_0_0/0.3)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
