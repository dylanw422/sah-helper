"use client";

import { FileTextIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type { ComponentProps } from "react";

export function AppBrand({ href, workspaceName }: { href?: ComponentProps<typeof Link>["href"]; workspaceName?: string }) {
  const content = <>
    <motion.div
      whileHover={{ rotate: 12, scale: 1.08 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-primary shadow-[0_0_12px_-2px_rgb(var(--accent-rgb)/0.6)]"
    >
      <FileTextIcon className="size-4 text-primary-foreground" />
    </motion.div>
    <span className="text-[13px] font-semibold tracking-[-0.01em]">SAH Helper</span>
    {workspaceName && <span className="hidden max-w-56 truncate border-l pl-3 text-xs text-muted-foreground sm:block">{workspaceName}</span>}
  </>;
  return href ? <Link href={href} className="group flex items-center gap-2.5">{content}</Link> : <div className="flex items-center gap-2.5">{content}</div>;
}
