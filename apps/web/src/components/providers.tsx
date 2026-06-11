"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { env } from "@sah-helper/env/web";
import { Toaster } from "@sah-helper/ui/components/sonner";
import { ConvexReactClient } from "convex/react";

import { authClient } from "@/lib/auth-client";

import { ThemeProvider } from "./theme-provider";

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

export default function Providers({
  children,
  initialToken,
}: {
  children: React.ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <ConvexBetterAuthProvider client={convex} authClient={authClient} initialToken={initialToken}>
        {children}
      </ConvexBetterAuthProvider>
      <Toaster richColors position="bottom-right" duration={3000} />
    </ThemeProvider>
  );
}
