import { redirect } from "next/navigation";
import { AuthGate } from "@/components/auth-gate";
import { isAuthenticated } from "@/lib/auth-server";

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/sign-in");
  return <main className="min-h-dvh"><AuthGate>{children}</AuthGate></main>;
}
