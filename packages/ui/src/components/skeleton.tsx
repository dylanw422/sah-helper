import { cn } from "@sah-helper/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-sm", className)}
      {...props}
    />
  );
}

export { Skeleton };
