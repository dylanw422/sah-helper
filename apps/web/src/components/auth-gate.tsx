"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import Loader from "./loader";

function RedirectToSignIn() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sign-in");
  }, [router]);
  return null;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Authenticated>{children}</Authenticated>
      <AuthLoading>
        <div className="flex h-[60svh] items-center justify-center">
          <Loader />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
    </>
  );
}
