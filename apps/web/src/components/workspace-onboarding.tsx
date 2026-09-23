"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { useMutation } from "convex/react";
import { BuildingIcon, FileCheckIcon, LockKeyholeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const fields = [
  ["companyName", "Company name", "organization", true],
  ["contractorName", "Contractor full name", "name", true],
  ["street", "Street address", "street-address", true],
  ["city", "City", "address-level2", true],
  ["state", "State", "address-level1", true],
  ["zip", "ZIP code", "postal-code", true],
  ["phone", "Business phone", "tel", true],
  ["license", "License number (optional)", "off", false],
] as const;

export default function WorkspaceOnboarding() {
  const create = useMutation(api.workspaces.create);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({
    companyName: "",
    contractorName: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    license: "",
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[0.8fr_1.2fr] md:py-20">
      <div>
        <BuildingIcon className="mb-6 size-9 text-primary" />
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Your company. Your workspace.
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Make room for your next project.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Set up your company once. We’ll use these details on your invoices and
          SAH paperwork, from the first packet through the final draw.
        </p>
        <div className="mt-8 space-y-5 text-sm">
          <p className="flex gap-3">
            <LockKeyholeIcon className="size-5 shrink-0 text-primary" />
            Private clients, files, pricing, and team access.
          </p>
          <p className="flex gap-3">
            <FileCheckIcon className="size-5 shrink-0 text-primary" />
            The same SAH forms and guided packet process.
          </p>
        </div>
      </div>
      <form
        className="grid grid-cols-1 gap-5 rounded-sm border bg-card p-6 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await create(values);
            toast.success("Your workspace is ready");
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not create workspace",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {fields.map(([key, label, autoComplete, required]) => (
          <div
            key={key}
            className={`space-y-2 ${key === "companyName" || key === "street" ? "sm:col-span-2" : ""}`}
          >
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              name={key}
              autoComplete={autoComplete}
              required={required}
              maxLength={200}
              type={key === "phone" ? "tel" : "text"}
              value={values[key]}
              disabled={saving}
              onChange={(e) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: e.target.value,
                }))
              }
            />
          </div>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
          You can update these details and add your team in Settings.
        </p>
        <Button type="submit" disabled={saving} className="sm:col-span-2">
          {saving ? "Creating workspace…" : "Create workspace"}
        </Button>
      </form>
    </div>
  );
}
