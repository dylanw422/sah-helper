"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { ArrowUpRightIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function FieldDashboard() {
  const projects = useQuery(api.field.listProjects);
  const [search, setSearch] = useState("");
  const filtered = projects?.filter(p => `${p.name} ${p.address}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="fg-kicker">On site. In sync.</div>
    <h1 className="fg-title">Your projects, at a glance.</h1>
    <p className="fg-subtitle">Coordinate every trade, document the work, and keep the office moving with you.</p>
    <div className="fg-metrics">
      <div className="fg-metric"><strong>{projects?.length ?? "—"}</strong><span>Assigned projects</span></div>
      <div className="fg-metric"><strong>{projects?.reduce((sum, p) => sum + p.submittedCount, 0) ?? "—"}</strong><span>Stages awaiting review</span></div>
      <div className="fg-metric"><strong>{projects?.reduce((sum, p) => sum + p.blockerCount, 0) ?? "—"}</strong><span>Reported blockers</span></div>
    </div>
    <div className="fw-row-between"><h2 className="fw-section-title">My projects</h2><span className="fw-pill">Live project updates</span></div>
    <input className="fg-search" aria-label="Search assigned projects" placeholder="Find a project or address..." value={search} onChange={e => setSearch(e.target.value)} />
    {!projects ? <p role="status" className="fw-note">Loading your assigned projects...</p> : !projects.length ? <div className="fw-empty">No projects assigned yet. Open an invitation link from the office to add your first project.</div>
      : !filtered?.length ? <div className="fw-empty">No projects match your search.</div>
      : <div className="fg-projects">{filtered.map(project => <Link key={project.id} href={`/field/projects/${project.id}`} className="fg-project">
        <div className="fw-row-between"><span className="fw-pill" data-status={project.blockerCount ? "blocked" : project.submittedCount ? "submitted" : "in_progress"}>{project.blockerCount ? "Issue needs attention" : project.submittedCount ? "Office review pending" : project.verifiedCount === project.stageCount ? "All stages verified" : "Construction in progress"}</span><ArrowUpRightIcon size={18} /></div>
        <h2>{project.name}</h2><p className="flex items-start gap-1.5"><MapPinIcon size={14} className="mt-0.5 shrink-0" />{project.address || "Address to be confirmed"}</p>
        <div className="fg-progress"><span style={{ width: `${project.stageCount ? project.verifiedCount / project.stageCount * 100 : 0}%` }} /></div>
        <div className="fg-project-footer"><span>{project.verifiedCount} of {project.stageCount} stages verified</span><span>Open project →</span></div>
        <p className="mt-4">Next: {project.nextStage ?? "Office closeout"}</p>
      </Link>)}</div>}
  </>;
}
