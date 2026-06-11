import { redirect } from "next/navigation";

import { AuthGate } from "@/components/auth-gate";
import Header from "@/components/header";
import { PageTransition } from "@/components/page-transition";
import { isAuthenticated } from "@/lib/auth-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1">
        <AuthGate>
          <PageTransition>{children}</PageTransition>
        </AuthGate>
      </main>
    </div>
  );
}
