"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeftIcon,
  BuildingIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MAX_GRANT_AMOUNT } from "@/lib/grant";

import { TemplatesTab } from "./templates-tab";

const FIELDS = [
  { key: "contractorCompanyName", label: "Company Name" },
  { key: "contractorName", label: "Contractor Full Name" },
  { key: "contractorStreet", label: "Address Line 1" },
  { key: "contractorCity", label: "City" },
  { key: "contractorState", label: "State" },
  { key: "contractorZip", label: "Zip Code" },
  { key: "contractorPhone", label: "Phone Number" },
  { key: "contractorEmail", label: "Email Address" },
  { key: "contractorLicense", label: "License Number" },
] as const;

type SettingsForm = Record<(typeof FIELDS)[number]["key"], string>;

const EMPTY: SettingsForm = {
  contractorCompanyName: "",
  contractorName: "",
  contractorStreet: "",
  contractorCity: "",
  contractorState: "",
  contractorZip: "",
  contractorPhone: "",
  contractorEmail: "",
  contractorLicense: "",
};

type Tab = "contractor" | "users" | "templates";

const TABS = [
  { key: "contractor", label: "Contractor info", icon: BuildingIcon },
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "templates", label: "Documents", icon: FileTextIcon },
] as const;

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  contractor: "Keep the business details used throughout your packets up to date.",
  users: "Invite teammates and manage access to your workspace.",
  templates: "Manage the templates and supporting documents used in packets.",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("contractor");
  const workspace = useQuery(api.workspaces.current);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:pt-10">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-indigo-600 uppercase dark:text-indigo-400">
            Workspace preferences
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-[34px]">Settings</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage your company, team, and packet documents.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Back to clients
        </Link>
      </div>

      <div className="mb-7 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-sm">
        <nav className="flex min-w-max items-center gap-1" aria-label="Settings sections">
          {TABS.filter(({ key }) => key !== "users" || workspace?.role !== "member").map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-surface-overlay hover:text-foreground"
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">
          {TABS.find(({ key }) => key === tab)?.label}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{TAB_DESCRIPTIONS[tab]}</p>
      </div>

      <div className="min-w-0">
        {tab === "contractor" ? <ContractorTab /> : tab === "users" ? <UsersTab /> : <TemplatesTab />}
      </div>
    </div>
  );
}

function ContractorTab() {
  const settings = useQuery(api.settings.getSettings);
  const updateSettings = useMutation(api.settings.updateSettings);
  const [form, setForm] = useState<SettingsForm>(EMPTY);
  const [maximumInvoiceAmount, setMaximumInvoiceAmount] = useState(String(MAX_GRANT_AMOUNT));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (settings && !hydrated) {
      setForm({
        contractorCompanyName: settings.contractorCompanyName,
        contractorName: settings.contractorName,
        contractorStreet: settings.contractorStreet,
        contractorCity: settings.contractorCity,
        contractorState: settings.contractorState,
        contractorZip: settings.contractorZip,
        contractorPhone: settings.contractorPhone,
        contractorEmail: settings.contractorEmail,
        contractorLicense: settings.contractorLicense,
      });
      setMaximumInvoiceAmount(String(settings.maximumInvoiceAmount ?? MAX_GRANT_AMOUNT));
      setHydrated(true);
    }
  }, [settings, hydrated]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const handleSave = async () => {
    const amount = Number(maximumInvoiceAmount);
    if (!maximumInvoiceAmount.trim() || !Number.isFinite(amount) || amount <= 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
      toast.error("Enter a positive maximum invoice amount with up to two decimal places.");
      return;
    }
    setSaving(true);
    try {
      await updateSettings({ ...form, maximumInvoiceAmount: amount });
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    } catch {
      toast.error("Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (settings === undefined) {
    return (
      <div className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <h3 className="text-sm font-semibold">Business details</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">These details appear on generated documents.</p>
      </div>
      <div className="grid grid-cols-1 gap-x-5 gap-y-5 p-5 sm:grid-cols-2 sm:p-6">
        {FIELDS.map(({ key, label }) => (
          <div
            key={key}
            className={`space-y-1.5 ${key === "contractorCompanyName" || key === "contractorStreet" ? "sm:col-span-2" : ""}`}
          >
            <Label htmlFor={key} className="text-xs font-medium text-foreground">
              {label}
            </Label>
            <Input
              id={key}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="h-10 rounded-lg bg-background"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5 border-t border-border px-5 py-5 sm:px-6">
        <Label htmlFor="maximumInvoiceAmount" className="text-xs font-medium text-foreground">
          Maximum Invoice Amount
        </Label>
        <div className="relative max-w-xs">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
          <Input
            id="maximumInvoiceAmount"
            type="number"
            min="0.01"
            step="0.01"
            value={maximumInvoiceAmount}
            onChange={(e) => setMaximumInvoiceAmount(e.target.value)}
            className="h-10 rounded-lg bg-background pl-7"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Used for invoice warnings and AI generated estimates in this workspace.
        </p>
      </div>

      <div className="flex justify-end border-t border-border bg-surface-overlay/40 px-5 py-4 sm:px-6">
        <Button className="w-full rounded-lg sm:w-auto" size="lg" onClick={handleSave} disabled={saving || saved}>
          <AnimatePresence mode="wait" initial={false}>
            {saved ? (
              <motion.span
                key="check"
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 20 }}
                className="flex items-center gap-1.5"
              >
                <CheckIcon className="size-4" />
                Saved
              </motion.span>
            ) : (
              <motion.span
                key="save"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </div>
    </div>
  );
}

function UsersTab() {
  const users = useQuery(api.users.listUsers);
  const addUser = useAction(api.users.addUser);
  const removeUser = useAction(api.users.removeUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [newInvite, setNewInvite] = useState<{ email: string; code: string } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: Id<"authorizedUsers">;
    email: string;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await removeUser({ id: pendingRemoval.id });
      if (newInvite?.email === pendingRemoval.email) setNewInvite(null);
      toast.success(`Removed ${pendingRemoval.email}`);
      setPendingRemoval(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove user.");
    } finally {
      setRemoving(false);
    }
  };

  const handleAdd = async () => {
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    if (!trimmedEmail || !trimmedName) return;
    setAdding(true);
    try {
      const { code } = await addUser({ email: trimmedEmail, name: trimmedName });
      setNewInvite({ email: trimmedEmail.toLowerCase(), code });
      setEmail("");
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add user.");
    } finally {
      setAdding(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard");
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-semibold">Invite a teammate</h3>
        <p className="mt-0.5 mb-5 text-xs text-muted-foreground">They can sign in using a one-time code.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-user-name" className="text-xs font-medium text-foreground">
              Name
            </Label>
            <Input
              id="new-user-name"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 h-10 rounded-lg bg-background"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
          </div>
          <div>
            <Label htmlFor="new-user-email" className="text-xs font-medium text-foreground">
              Email
            </Label>
            <Input
              id="new-user-email"
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              className="mt-1.5 h-10 rounded-lg bg-background"
            />
          </div>
        </div>
        <Button className="mt-5 rounded-lg" onClick={handleAdd} disabled={adding || !email.trim() || !name.trim()}>
          <PlusIcon className="size-4" />
          {adding ? "Adding..." : "Add user"}
        </Button>

        <AnimatePresence>
          {newInvite && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-5 rounded-lg border border-indigo-300 bg-accent p-4 text-center dark:border-indigo-800">
                <p className="text-xs text-muted-foreground">
                  One-time sign-in code for <span className="font-medium">{newInvite.email}</span>
                </p>
                <button
                  type="button"
                  onClick={() => copyCode(newInvite.code)}
                  className="mt-2 inline-flex items-center gap-2 font-mono text-3xl font-bold tracking-[0.3em] text-indigo-700 dark:text-indigo-300"
                  title="Copy code"
                >
                  {newInvite.code}
                  <CopyIcon className="size-4 opacity-60" />
                </button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  They sign in with their email and this code, then set their own password.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h3 className="text-sm font-semibold">Workspace users</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {users === undefined ? "Loading users" : `${users.length} ${users.length === 1 ? "person" : "people"} with access`}
          </p>
        </div>
        {users === undefined ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="p-5 text-center text-xs text-muted-foreground">
            No invited users yet. Add an email above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((user) => (
              <li key={user._id} className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-overlay sm:px-6">
                <div className="min-w-0">
                  {user.name && <p className="truncate text-sm font-medium">{user.name}</p>}
                  <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {user.passwordSet ? "Active" : "Pending first sign-in"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {user.passwordSet ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                      <CheckIcon className="size-3.5" />
                      Active
                    </span>
                  ) : user.code ? (
                    <button
                      type="button"
                      onClick={() => copyCode(user.code!)}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-2 py-1 font-mono text-xs font-semibold tracking-[0.2em] text-indigo-700 dark:text-indigo-300"
                      title="Copy code"
                    >
                      {user.code}
                      <CopyIcon className="size-3 opacity-60" />
                    </button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    title="Remove user"
                    onClick={() => setPendingRemoval({ id: user._id, email: user.email })}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove user?"
        description={`${pendingRemoval?.email ?? ""} will lose access immediately and their account will be deleted.`}
        confirmLabel="Remove"
        confirming={removing}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
}
