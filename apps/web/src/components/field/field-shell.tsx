"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AppBrand } from "@/components/app-brand";
import { FieldButton } from "./field-button";
import "./field.css";

export function FieldShell({ children }: { children: React.ReactNode }) {
  const { token } = useParams<{ token?: string }>();
  if (token) return <div className="field-portal">
    <header className="fg-header"><div className="fg-header-inner"><AppBrand /><span className="fg-link-badge">Field GC</span></div></header>
    <main className="fg-main">{children}</main>
  </div>;
  return <div className="field-portal"><Authenticated><SignedInShell>{children}</SignedInShell></Authenticated>
    <AuthLoading><p role="status" className="fg-main">Opening your workspace...</p></AuthLoading>
    <Unauthenticated><div className="fg-main"><h1 className="fg-title">Open your project link</h1><p className="fg-subtitle">Use the project link shared by your office. No account is needed.</p></div></Unauthenticated>
  </div>;
}
function SignedInShell({ children }: { children: React.ReactNode }) {
  const access = useQuery(api.field.current);
  const router = useRouter();
  if (!access) return <p role="status" className="fg-main">Opening your workspace...</p>;
  return <>
    <header className="fg-header"><div className="fg-header-inner"><AppBrand href="/field" />
      <div className="fg-account"><span>{access.name}</span><FieldButton className="fw-button" variant="ghost" onClick={async () => { await authClient.signOut(); router.replace("/sign-in"); router.refresh(); }}>Sign out</FieldButton></div></div>
    </header>
    {access.mode === "office" && <div className="fg-preview">Office preview · <Link className="underline" href="/dashboard">Return to your office dashboard</Link></div>}
    <main className="fg-main">{access.mode === "unassigned" ? <div className="fw-empty">Open the project link shared by your office to get started. No account is needed.</div> : children}</main>
  </>;
}
