"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";

const groups = [
  ["waiver", "Waivers"],
  ["spec-sheet", "Specification Sheets"],
  ["job-specific", "Job-Specific Documents"],
] as const;

export function BundleDocuments({ selected, onChange, missing = [] }: {
  selected: Id<"customDocuments">[];
  onChange: (ids: Id<"customDocuments">[]) => void;
  missing?: { documentId: Id<"customDocuments">; displayName: string }[];
}) {
  const documents = useQuery(api.customDocuments.listCustomDocuments, {});
  return (
    <div className="space-y-3">
      {documents === undefined && <p className="text-xs text-muted-foreground">Loading documents…</p>}
      {groups.map(([category, title]) => {
        const available = documents?.filter(doc => doc.category === category) ?? [];
        return (
          <fieldset key={category} className="rounded-md border p-3">
            <legend className="px-1 text-xs font-semibold">{title}</legend>
            {documents && available.length === 0 && <p className="text-xs text-muted-foreground">None in the library.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map(doc => (
                <label key={doc._id} className="flex cursor-pointer items-start gap-2 text-xs">
                  <input type="checkbox" checked={selected.includes(doc._id)}
                    onChange={event => onChange(event.target.checked
                      ? [...selected, doc._id]
                      : selected.filter(id => id !== doc._id))} />
                  <span>{doc.displayName}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      {missing.map(doc => (
        <div key={doc.documentId} className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <span>{doc.displayName} is no longer available.</span>
          <button type="button" className="font-medium underline" onClick={() => onChange(selected.filter(id => id !== doc.documentId))}>Remove</button>
        </div>
      ))}
    </div>
  );
}
