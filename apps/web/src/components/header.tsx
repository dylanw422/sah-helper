"use client";

import { Button } from "@sah-helper/ui/components/button";
import { FileTextIcon, SettingsIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { useScrollOpacity } from "@/hooks/use-scroll-opacity";

import UserMenu from "./user-menu";

export default function Header() {
  const scrollOpacity = useScrollOpacity();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface-base/85 backdrop-blur-xl backdrop-saturate-150">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent"
        style={{ opacity: scrollOpacity }}
      />
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/dashboard" className="group flex items-center gap-2.5">
          <motion.div
            whileHover={{ rotate: 12, scale: 1.08 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="flex size-7 items-center justify-center rounded-sm bg-indigo-500 shadow-[0_0_12px_-2px_rgb(99_102_241/0.6)]"
          >
            <FileTextIcon className="size-4 text-white" />
          </motion.div>
          <span className="text-[13px] font-semibold tracking-[-0.01em]">SAH Helper</span>
        </Link>

        <div className="flex items-center gap-1.5">
          <UserMenu />
          <Link href="/settings" aria-label="Settings">
            <Button variant="ghost" size="icon-sm">
              <SettingsIcon className="size-4" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
