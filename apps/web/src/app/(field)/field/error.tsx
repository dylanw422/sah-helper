"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FieldButton } from "@/components/field/field-button";

export default function FieldError({ reset }: { reset: () => void }) {
  const { token } = useParams<{ token?: string }>();
  return <div className="fw-empty">
    <h1 className="fw-section-title">This project could not be opened</h1>
    <p>The project link may have changed, or your connection was interrupted. Try again or ask the office for a new link.</p>
    <div className="fw-actions justify-center"><FieldButton className="fw-button" onClick={reset}>Try again</FieldButton>{!token && <Link className="fw-button" href="/field">My projects</Link>}</div>
  </div>;
}
