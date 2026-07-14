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

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  contractor: "Contractor information used to fill all VA documents.",
  users: "Manage who can sign in to this application.",
  templates:
    "Upload the 12 blank VA templates. Field mapping happens automatically on upload — AI matches each PDF's form fields to packet data. Use Inspect to review the result.",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("contractor");

  return (
    <div
      className={`mx-auto w-full px-4 py-8 ${tab === "templates" ? "max-w-5xl" : "max-w-3xl"}`}
    >
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to Clients
      </Link>

      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">Settings</h1>
      <p className="mb-8 text-xs text-muted-foreground">{TAB_DESCRIPTIONS[tab]}</p>

      <div className="flex flex-col gap-8 sm:flex-row">
        <nav className="flex shrink-0 gap-2 sm:w-44 sm:flex-col sm:gap-1.5">
          <button
            type="button"
            onClick={() => setTab("contractor")}
            className={`flex items-center gap-2.5 rounded-sm px-3 py-2 text-xs font-medium transition-colors ${
              tab === "contractor"
                ? "bg-accent text-indigo-700 ring-1 ring-[rgb(var(--accent-rgb)/0.25)] dark:text-indigo-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BuildingIcon className="size-3.5" />
            Contractor Info
          </button>
          <button
            type="button"
            onClick={() => setTab("users")}
            className={`flex items-center gap-2.5 rounded-sm px-3 py-2 text-xs font-medium transition-colors ${
              tab === "users"
                ? "bg-accent text-indigo-700 ring-1 ring-[rgb(var(--accent-rgb)/0.25)] dark:text-indigo-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UsersIcon className="size-3.5" />
            Users
          </button>
          <button
            type="button"
            onClick={() => setTab("templates")}
            className={`flex items-center gap-2.5 rounded-sm px-3 py-2 text-xs font-medium transition-colors ${
              tab === "templates"
                ? "bg-accent text-indigo-700 ring-1 ring-[rgb(var(--accent-rgb)/0.25)] dark:text-indigo-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileTextIcon className="size-3.5" />
            Documents
          </button>
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "contractor" ? (
            <ContractorTab />
          ) : tab === "users" ? (
            <UsersTab />
          ) : (
            <TemplatesTab />
          )}
        </div>
      </div>
    </div>
  );
}

function ContractorTab() {
  const settings = useQuery(api.settings.getSettings);
  const updateSettings = useMutation(api.settings.updateSettings);
  const [form, setForm] = useState<SettingsForm>(EMPTY);
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
      setHydrated(true);
    }
  }, [settings, hydrated]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(form);
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
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, label }) => (
          <div
            key={key}
            className={`space-y-1.5 ${key === "contractorCompanyName" || key === "contractorStreet" ? "sm:col-span-2" : ""}`}
          >
            <Label
              htmlFor={key}
              className="text-[10px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase"
            >
              {label}
            </Label>
            <Input
              id={key}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <Button
        className="mt-6 w-full sm:w-32"
        size="lg"
        onClick={handleSave}
        disabled={saving || saved}
      >
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
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-5">
        <p className="text-[10px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase mb-3">
          Add User
        </p>
        <div className="space-y-2">
          <div>
            <Label
              htmlFor="new-user-name"
              className="text-[10px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase"
            >
              Name
            </Label>
            <Input
              id="new-user-name"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
          </div>
          <div>
            <Label
              htmlFor="new-user-email"
              className="text-[10px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase"
            >
              Email
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="new-user-email"
                type="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
              <Button onClick={handleAdd} disabled={adding || !email.trim() || !name.trim()}>
                <PlusIcon className="size-4" />
                {adding ? "Adding..." : "Add"}
              </Button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {newInvite && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 rounded-md border border-indigo-300 bg-accent p-4 text-center dark:border-indigo-800">
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

      <div className="rounded-md border border-border bg-card">
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
              <li key={user._id} className="flex items-center justify-between gap-3 px-5 py-3">
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
