import { notFound } from "next/navigation";

import InspectTemplatesView from "./inspect-view";

export default function InspectTemplatesPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  return <InspectTemplatesView />;
}
