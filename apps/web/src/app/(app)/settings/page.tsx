"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { Skeleton } from "@sah-helper/ui/components/skeleton";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftIcon, BuildingIcon, CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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

export default function SettingsPage() {
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
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Skeleton className="mb-5 h-3.5 w-28" />
        <Skeleton className="mb-1 h-7 w-32" />
        <Skeleton className="mb-8 h-3.5 w-72" />
        <div className="flex flex-col gap-8 sm:flex-row">
          <Skeleton className="h-9 w-full sm:w-44" />
          <div className="flex-1 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to Clients
      </Link>

      <h1 className="mb-1 text-xl font-semibold tracking-[-0.025em]">Settings</h1>
      <p className="mb-8 text-xs text-muted-foreground">
        Contractor information used to fill all VA documents.
      </p>

      <div className="flex flex-col gap-8 sm:flex-row">
        <nav className="shrink-0 sm:w-44">
          <div className="flex items-center gap-2.5 rounded-sm bg-accent px-3 py-2 text-xs font-medium text-indigo-700 ring-1 ring-[rgb(var(--accent-rgb)/0.25)] dark:text-indigo-300">
            <BuildingIcon className="size-3.5" />
            Contractor Info
          </div>
        </nav>

        <div className="min-w-0 flex-1">
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
        </div>
      </div>
    </div>
  );
}
