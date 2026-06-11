"use client";

import { FileTextIcon } from "lucide-react";
import { motion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useScrollOpacity } from "@/hooks/use-scroll-opacity";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const NAV_ITEMS: { href: Route; label: string }[] = [
  { href: "/dashboard", label: "Clients" },
  { href: "/new-packet", label: "New Packet" },
  { href: "/settings", label: "Settings" },
];

function NavItem({ href, label, active }: { href: Route; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`relative rounded-sm px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId="nav-active-pill"
          className="absolute inset-0 rounded-sm bg-accent ring-1 ring-[rgb(var(--accent-rgb)/0.25)]"
          transition={{ type: "spring", stiffness: 500, damping: 42 }}
        />
      )}
      <span className="relative z-10">{label}</span>
    </Link>
  );
}

export default function Header() {
  const pathname = usePathname();
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

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map(({ href, label }) => (
            <NavItem key={href} href={href} label={label} active={pathname.startsWith(href)} />
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
