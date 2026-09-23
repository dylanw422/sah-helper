"use client";

import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { BuildingIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="flex min-h-svh items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <BuildingIcon className="mb-6 size-9 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">
          Start your contractor workspace
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Create your account, then set up your company for SAH invoices and
          packets.
        </p>
        <form
          className="mt-8 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const result = await authClient.signUp.email({
                name: String(data.get("name")).trim(),
                email: String(data.get("email")).trim().toLowerCase(),
                password: String(data.get("password")),
              });
              if (result.error)
                setError(result.error.message ?? "Could not create account");
              else {
                router.replace("/dashboard");
                router.refresh();
              }
            } catch {
              setError("Could not create account. Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="name">Your full name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button className="w-full" disabled={busy} type="submit">
            {busy ? "Creating account…" : "Continue to company setup"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
