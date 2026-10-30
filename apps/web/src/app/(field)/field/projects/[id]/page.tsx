"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import type { Id } from "@sah-helper/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ArrowLeftIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FieldProjectBoard } from "@/components/field/project-board";

export default function FieldProjectPage() {
  const { id } = useParams<{ id: string }>();
  const clientId = id as Id<"clients">;
  const data = useQuery(api.field.getProject, { clientId });
  return <><Link href="/field" className="fw-back"><ArrowLeftIcon size={14} />All projects</Link>
    <div className="fg-kicker">Project workspace</div><h1 className="fg-title">{data?.project.name ?? "Loading project..."}</h1>
    {data && <p className="fg-subtitle flex items-start gap-2"><MapPinIcon size={17} className="mt-0.5 shrink-0" />{data.project.address || "Address to be confirmed"}</p>}
    <FieldProjectBoard clientId={clientId} mode="field" />
  </>;
}
