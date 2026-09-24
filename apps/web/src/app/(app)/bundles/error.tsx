"use client";

import { Button } from "@sah-helper/ui/components/button";

export default function BundlesError({ reset }: { error: Error; reset: () => void }) {
  return <div className="mx-auto max-w-lg px-4 py-20 text-center">
    <h1 className="text-lg font-semibold">Could not load bundles</h1>
    <p className="mt-2 text-xs text-muted-foreground">Check your connection and try again.</p>
    <Button className="mt-5" onClick={reset}>Try Again</Button>
  </div>;
}
