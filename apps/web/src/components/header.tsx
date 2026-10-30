"use client";

import { Button } from "@sah-helper/ui/components/button";
import { PencilRulerIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { api } from "@sah-helper/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import { useScrollOpacity } from "@/hooks/use-scroll-opacity";

import UserMenu from "./user-menu";
import { AppBrand } from "./app-brand";

export default function Header() {
  const scrollOpacity = useScrollOpacity();
  const workspace = useQuery(api.workspaces.current);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface-base/85 backdrop-blur-xl backdrop-saturate-150">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent"
        style={{ opacity: scrollOpacity }}
      />
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <AppBrand href="/dashboard" workspaceName={workspace?.name} />

        <div className="flex items-center gap-1.5">
          <Link href="/floor-plans" aria-label="Floor plans" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <PencilRulerIcon className="size-4" />
            <span className="hidden sm:inline">Floor plans</span>
          </Link>
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
