"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { MapPinIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { FieldProjectBoard } from "@/components/field/project-board";

export default function FieldLinkProject() {
  const { token } = useParams<{ token: string }>();
  const data = useQuery(api.field.linkProject, { token });
  if (data === undefined) return <p role="status" className="fw-note">Opening your project…</p>;
  if (!data) return <div className="fw-empty"><h1 className="fg-title">Project link unavailable</h1><p className="fg-subtitle">This link was replaced or revoked, or the project is no longer available. Ask your office for a new link.</p></div>;
  return <>
    <div className="fg-kicker">Project overview</div>
    <h1 className="fg-title">{data.project.name}</h1>
    <p className="fg-subtitle flex items-start gap-2"><MapPinIcon size={17} className="mt-0.5 shrink-0" />{data.project.address || "Address to be confirmed"}</p>
    <p className="fw-note">{data.label} · Updates appear on your office’s dashboard. Save this link to return to the project.</p>
    <FieldProjectBoard clientId={data.project.id} mode="field" token={token} />
  </>;
}
