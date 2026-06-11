"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Doc } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { useQuery } from "convex/react";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ClientFileDrawer } from "@/components/client-file-drawer";
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
    return (clients ?? []).filter((client) => {
      if (filter !== "all" && client.status !== filter) return false;
      if (search && !client.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [clients, filter, search]);

  const cycleFilter = (dir: 1 | -1) => {
    const idx = FILTERS.findIndex((f) => f.key === filter);
    const next = FILTERS[(idx + dir + FILTERS.length) % FILTERS.length];
    if (next) setFilter(next.key);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      {settings === null && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span>
            Contractor information is not configured. Packets cannot be generated until settings
            are complete.
          </span>
          <Link href="/settings" className="ml-auto shrink-0 font-medium underline">
            Configure Settings
          </Link>
        </motion.div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-[-0.025em]">Clients</h1>
        <Link href="/new-packet">
          <Button size="lg" className="w-full sm:w-auto">
            <PlusIcon data-icon="inline-start" />
            New Packet
          </Button>
        </Link>
      </div>

      <motion.div
        variants={stagger(0.06)}
        initial="hidden"
        animate="visible"
        className="mb-6 grid grid-cols-3 gap-3 sm:gap-4"
      >
        {[
          { label: "Total Clients", value: clients === undefined ? "—" : String(counts.all) },
          { label: "Total Value", value: clients === undefined ? "—" : formatCurrency(totalValue) },
          { label: "Completed", value: clients === undefined ? "—" : `${completionPct}%` },
        ].map(({ label, value }) => (
          <motion.div
            key={label}
            variants={fadeUp}
            className="rounded-md border border-border bg-card px-4 py-3"
          >
            <p className="mb-1 text-[10px] font-medium tracking-[0.1em] uppercase text-muted-foreground/70">
              {label}
            </p>
            <p className="font-mono text-xl font-semibold tabular-nums">{value}</p>
          </motion.div>
        ))}
      </motion.div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex w-fit items-center rounded-md border border-border bg-card p-0.5"
          role="tablist"
          aria-label="Filter clients by status"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") cycleFilter(1);
            if (e.key === "ArrowLeft") cycleFilter(-1);
          }}
        >
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className="relative rounded-sm px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {filter === key && (
                <motion.span
                  layoutId="filter-indicator"
                  className="absolute inset-0 rounded-sm bg-primary"
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
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
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
  const { download, downloading } = usePacketDownload(client._id);

  return (
    <div className="group relative rounded-md border border-border bg-card transition-all duration-200 hover:border-[rgb(var(--border-default-rgb)/var(--border-hover-alpha))] hover:bg-surface-overlay hover:shadow-[0_8px_32px_-8px_rgb(0_0_0/0.4)]">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle files for ${client.name}`}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((x) => !x);
          }
        }}
        className="flex cursor-pointer items-center gap-4 px-4 py-3.5"
      >
        <div
          className={`absolute top-3 bottom-3 left-0 w-0.5 rounded-full ${STATUS_BAR_COLOR[status]}`}
        />

        <div className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-accent font-mono text-[11px] font-semibold tracking-tight text-indigo-600 dark:text-indigo-400">
          {initials(client.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <Link
              href={`/clients/${client._id}`}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 truncate underline-offset-4 hover:underline"
            >
              <motion.span
                layoutId={`client-name-${client._id}`}
                className="truncate text-[14px] font-semibold"
              >
                {client.name}
              </motion.span>
            </Link>
            <StatusBadge status={status} />
          </div>
          <p className="truncate text-xs text-muted-foreground/70">
            {client.street}, {client.city}, {client.state} {client.zip}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-5 text-right sm:flex">
          <div>
            <p className="font-mono text-[14px] font-semibold tabular-nums">
              {formatCurrency(client.total)}
            </p>
            <p className="text-[11px] text-muted-foreground/70">{client.drawCount} draws</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground/70">Created</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {formatDate(client.createdAt)}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
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
          className="relative shrink-0"
        >
          <DownloadIcon className="size-3.5" />
          <span className="hidden md:inline">{downloading ? "Downloading..." : "Download"}</span>
          {client.packetDirty && (
            <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
          )}
        </Button>

        <ChevronRightIcon
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-4">
              <ClientFileDrawer clientId={client._id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClientRowSkeleton() {
  return (
    <div className="relative flex items-center gap-4 rounded-md border border-border bg-card px-4 py-3.5">
      <div className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-muted" />
      <div className="skeleton-shimmer size-9 shrink-0 rounded-sm" />
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
      className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-20 text-center"
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-md bg-accent text-indigo-600 dark:text-indigo-400">
        {hasClients ? <SearchXIcon className="size-7" /> : <FolderOpenIcon className="size-7" />}
      </div>
      {hasClients ? (
        <>
          <p className="mb-1 text-sm font-medium">No clients match your filters</p>
          <p className="mb-5 text-xs text-muted-foreground">
            Try a different status or clear your search.
          </p>
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <p className="mb-1 text-sm font-medium">No clients yet</p>
          <p className="mb-5 text-xs text-muted-foreground">
            Upload your first invoice to get started.
          </p>
          <Link href="/new-packet">
            <Button>
              <PlusIcon data-icon="inline-start" />
              New Packet
            </Button>
          </Link>
        </>
      )}
    </motion.div>
  );
}
