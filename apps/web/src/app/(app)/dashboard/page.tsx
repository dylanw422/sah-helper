"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button, buttonVariants } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { useQuery } from "convex/react";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  FolderOpenIcon,
  ReceiptIcon,
  SearchIcon,
  SearchXIcon,
  UsersRoundIcon,
  WalletIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ClientFileList } from "@/components/client-file-drawer";
import { StatusBadge } from "@/components/status-badge";
import { usePacketDownload } from "@/lib/download";
import { fadeUp, stagger } from "@/lib/motion";
import { formatCurrency, formatDate, initials, type ClientStatus } from "@/lib/format";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unsigned", label: "Unsigned" },
  { key: "signed", label: "Signed" },
  { key: "complete", label: "Complete" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const STATUS_BAR_COLOR: Record<ClientStatus, string> = {
  unsigned: "bg-amber-400",
  signed: "bg-indigo-400",
  complete: "bg-emerald-400",
};

export default function DashboardPage() {
  const clients = useQuery(api.clients.listClients);
  const settings = useQuery(api.settings.getSettings);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, unsigned: 0, signed: 0, complete: 0 };
    for (const client of clients ?? []) {
      c.all++;
      c[client.status]++;
    }
    return c;
  }, [clients]);

  const totalValue = useMemo(
    () => (clients ?? []).reduce((sum, client) => sum + client.total, 0),
    [clients],
  );
  const completionPct = counts.all === 0 ? 0 : Math.round((counts.complete / counts.all) * 100);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (clients ?? []).filter((client) => {
      if (filter !== "all" && client.status !== filter) return false;
      if (term && ![
        client.name,
        `${client.street}, ${client.city}, ${client.state} ${client.zip}`,
        client.caseNumber ?? "",
      ].some((value) => value.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [clients, filter, search]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:pt-10">
      {settings === null && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-7 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span>
            Contractor information is not configured. Packets cannot be generated until settings are
            complete.
          </span>
          <Link href="/settings" className="ml-auto shrink-0 font-semibold underline underline-offset-4 hover:no-underline">
            Configure Settings
          </Link>
        </motion.div>
      )}

      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-indigo-600 uppercase dark:text-indigo-400">
            Workspace overview
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[34px]">Clients</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Track packets, documents, and progress in one place.
          </p>
        </div>
        <Link
          href="/invoices"
          className="group inline-flex min-h-12 w-full items-center gap-3 rounded-lg border border-indigo-400/30 bg-primary px-3 py-2 text-primary-foreground shadow-[0_8px_24px_-12px_rgb(79_70_229/0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgb(79_70_229/0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 sm:w-auto"
        >
          <span className="flex size-8 items-center justify-center rounded-md border border-white/15 bg-white/15">
            <ReceiptIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="flex flex-1 flex-col leading-tight sm:flex-none">
            <span className="text-sm font-semibold tracking-[-0.015em]">Invoices</span>
            <span className="text-[10px] text-white/75">Create &amp; manage</span>
          </span>
          <ArrowUpRightIcon className="ml-3 size-4 text-white/75 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
        </Link>
      </div>

      <motion.div
        variants={stagger(0.06)}
        initial="hidden"
        animate="visible"
        className="mb-10 grid gap-3 sm:grid-cols-3 sm:gap-4"
      >
        <motion.div variants={fadeUp} className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <p className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">Total clients</p>
            <span className="flex size-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"><UsersRoundIcon className="size-4" /></span>
          </div>
          <p className="font-mono text-3xl font-semibold tracking-[-0.06em] tabular-nums">{clients === undefined ? "—" : counts.all}</p>
          <p className="mt-2 text-xs text-muted-foreground">In your workspace</p>
        </motion.div>
        <motion.div variants={fadeUp} className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <p className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">Total value</p>
            <span className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400"><WalletIcon className="size-4" /></span>
          </div>
          <p className="font-mono text-[clamp(1.25rem,2.3vw,1.875rem)] font-semibold tracking-[-0.06em] tabular-nums">{clients === undefined ? "—" : formatCurrency(totalValue)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Across all client packets</p>
        </motion.div>
        <motion.div variants={fadeUp} className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <p className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">Completed</p>
            <span className="flex size-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><CircleCheckIcon className="size-4" /></span>
          </div>
          <p className="font-mono text-3xl font-semibold tracking-[-0.06em] tabular-nums">{clients === undefined ? "—" : `${completionPct}%`}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-emerald-500/10">
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${completionPct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{clients === undefined ? "Loading clients" : `${counts.complete} of ${counts.all} clients`}</p>
        </motion.div>
      </motion.div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em]">Client directory</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {clients === undefined ? "Loading clients" : `Showing ${filtered.length} of ${counts.all} clients`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients"
            aria-label="Search clients by name, address, or case number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-lg bg-card pl-10"
          />
        </div>
      </div>

      <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-card p-1">
        <div className="flex min-w-max items-center gap-1" role="group" aria-label="Filter clients by status">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className="relative rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {filter === key && (
                <motion.span
                  layoutId="filter-indicator"
                  className="absolute inset-0 rounded-md bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 42 }}
                />
              )}
              <span
                className={`relative z-10 flex items-center gap-1.5 ${
                  filter === key ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
                <span
                  className={`rounded-sm px-1 font-mono text-[10px] tabular-nums ${
                    filter === key ? "bg-primary-foreground/20" : "bg-muted"
                  }`}
                >
                  {counts[key]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {clients === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <ClientRowSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          hasClients={(clients ?? []).length > 0}
          onClear={() => {
            setFilter("all");
            setSearch("");
          }}
        />
      ) : (
        <motion.div variants={stagger()} initial="hidden" animate="visible" className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((client) => (
              <motion.div
                key={client._id}
                layout
                variants={fadeUp}
                exit="exit"
                transition={{ type: "spring", stiffness: 500, damping: 42 }}
              >
                <ClientRow client={client} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function ClientRow({ client }: { client: Doc<"clients"> }) {
  const status = client.status as ClientStatus;
  const [expanded, setExpanded] = useState(false);
  const [filesRequested, setFilesRequested] = useState(false);
  const { download, downloading } = usePacketDownload(client._id);

  // The drawer mounts only once files are loaded, so its open animation
  // measures the real content height instead of a loading spinner.
  const files = useQuery(
    api.clientFiles.listClientFiles,
    filesRequested ? { clientId: client._id } : "skip",
  );

  const toggle = () => {
    setExpanded((e) => !e);
    setFilesRequested(true);
  };

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card transition-colors duration-200 hover:border-foreground/20 hover:bg-surface-overlay focus-within:border-foreground/20">
      <div
        onClick={toggle}
        className="flex cursor-pointer items-center gap-2 px-4 py-4 sm:gap-4 sm:px-5"
      >
        <div
          className={`absolute inset-y-0 left-0 w-1 ${STATUS_BAR_COLOR[status]}`}
        />

        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent font-mono text-[11px] font-semibold tracking-tight text-indigo-600 sm:size-10 dark:text-indigo-400">
          {initials(client.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <Link
              href={`/clients/${client._id}`}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 max-w-full truncate rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <motion.span
                layoutId={`client-name-${client._id}`}
                className="block truncate text-[14px] font-semibold tracking-[-0.01em]"
              >
                {client.name}
              </motion.span>
            </Link>
            <StatusBadge status={status} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {client.street}, {client.city}, {client.state} {client.zip}
            {client.caseNumber && <span className="hidden md:inline"> · Case {client.caseNumber}</span>}
          </p>
          <p className="mt-1.5 font-mono text-xs font-medium tabular-nums sm:hidden">
            {formatCurrency(client.total)} <span className="font-sans font-normal text-muted-foreground">· {client.drawCount} draws</span>
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-5 text-right sm:flex">
          <div>
            <p className="font-mono text-[14px] font-semibold tabular-nums">
              {formatCurrency(client.total)}
            </p>
            <p className="text-[11px] text-muted-foreground">{client.drawCount} draws</p>
          </div>
          <div className="hidden lg:block">
            <p className="text-[11px] text-muted-foreground">Created</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {formatDate(client.createdAt)}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="icon-lg"
          aria-label={`Download packet for ${client.name}`}
          disabled={!client.packetStorageId || downloading}
          onClick={(e) => {
            e.stopPropagation();
            void download(client.packetDirty);
          }}
          title={
            client.packetDirty
              ? "New files added — packet will be rebuilt on download."
              : "Download Packet.pdf"
          }
          className="relative shrink-0 rounded-md"
        >
          <DownloadIcon className="size-4" />
          {client.packetDirty && (
            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
          )}
        </Button>

        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} files for ${client.name}`}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon className={`size-4 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && files !== undefined && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border bg-surface-sunken/40 px-4 py-4 sm:px-5">
              <ClientFileList clientId={client._id} files={files} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClientRowSkeleton() {
  return (
    <div className="relative flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-4 sm:px-5">
      <div className="absolute inset-y-0 left-0 w-1 bg-muted" />
      <div className="skeleton-shimmer size-9 shrink-0 rounded-md sm:size-10" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-4 w-36 rounded-sm" />
          <div className="skeleton-shimmer h-4 w-16 rounded-sm" />
        </div>
        <div className="skeleton-shimmer h-3 w-64 max-w-full rounded-sm" />
      </div>
      <div className="hidden shrink-0 items-center gap-5 sm:flex">
        <div className="space-y-1.5">
          <div className="skeleton-shimmer h-4 w-20 rounded-sm" />
          <div className="skeleton-shimmer ml-auto h-3 w-14 rounded-sm" />
        </div>
        <div className="space-y-1.5">
          <div className="skeleton-shimmer h-3 w-12 rounded-sm" />
          <div className="skeleton-shimmer h-3 w-16 rounded-sm" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasClients, onClear }: { hasClients: boolean; onClear: () => void }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/60 px-5 py-16 text-center"
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-lg bg-accent text-indigo-600 dark:text-indigo-400">
        {hasClients ? <SearchXIcon className="size-7" /> : <FolderOpenIcon className="size-7" />}
      </div>
      {hasClients ? (
        <>
          <p className="mb-1 text-base font-semibold">No clients match your filters</p>
          <p className="mb-5 text-xs text-muted-foreground">
            Try a different status or clear your search.
          </p>
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <p className="mb-1 text-base font-semibold">No clients yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            Create an invoice and start a packet to see your clients here.
          </p>
          <Link href="/invoices" className={buttonVariants({ variant: "outline", className: "mt-5" })}>
            View invoices <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </>
      )}
    </motion.div>
  );
}
