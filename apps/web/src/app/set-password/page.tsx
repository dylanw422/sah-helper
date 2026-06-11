import { redirect } from "next/navigation";

import { isAuthenticated } from "@/lib/auth-server";

import SetPasswordView from "./set-password-view";

export default async function SetPasswordPage() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }
  return <SetPasswordView />;
}
