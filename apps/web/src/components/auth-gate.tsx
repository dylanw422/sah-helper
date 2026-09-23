"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import Loader from "./loader";
import WorkspaceOnboarding from "./workspace-onboarding";
import { WorkspaceContext } from "./workspace-context";

function RedirectToSignIn() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sign-in");
  }, [router]);
  return null;
}

function PasswordSetupGate({ children }: { children: React.ReactNode }) {
  const status = useQuery(api.users.passwordSetupStatus);
  const workspace = useQuery(api.workspaces.current);
  const router = useRouter();

  useEffect(() => {
    if (status?.needsSetup) {
      router.replace("/set-password");
    }
  }, [status, router]);

  if (status === undefined || status.needsSetup || workspace === undefined) {
    return (
      <div className="flex h-[60svh] items-center justify-center">
        <Loader />
      </div>
    );
  }
  if (!workspace) return <WorkspaceOnboarding />;
  return (
    <WorkspaceContext.Provider value={workspace.id}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Authenticated>
        <PasswordSetupGate>{children}</PasswordSetupGate>
      </Authenticated>
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
