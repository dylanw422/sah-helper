import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import FieldLinkProject from "../../apps/web/src/app/(field)/field/link/[token]/page";
import { FieldShell } from "../../apps/web/src/components/field/field-shell";
import { OfficeFieldProject } from "../../apps/web/src/components/field/office-project";
import { OfficeProjectUpdates } from "../../apps/web/src/components/field/office-updates";
import type { Id } from "../../packages/backend/convex/_generated/dataModel";
import "../../apps/web/src/index.css";

const office = new URLSearchParams(location.search).get("office") === "1";
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<StrictMode>
  {office ? <main className="mx-auto max-w-4xl p-6"><p className="mb-6 text-xs text-muted-foreground">Isolated workflow test · Office dashboard</p><OfficeProjectUpdates /><OfficeFieldProject clientId={"client-demo" as Id<"clients">} /></main>
    : <FieldShell><FieldLinkProject /></FieldShell>}
  <Toaster />
</StrictMode>);
