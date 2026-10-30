"use client";

import { Button } from "@sah-helper/ui/components/button";
import type { ComponentProps } from "react";

// Keep the shared app control's behavior and variants, with larger field targets.
export function FieldButton({ variant = "outline", type = "submit", ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} type={type} variant={variant} />;
}
