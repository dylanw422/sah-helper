import { redirect } from "next/navigation";

import { isAuthenticated } from "@/lib/auth-server";

import SignInView from "./sign-in-view";

export default async function SignInPage() {
  if (await isAuthenticated()) {
    redirect("/dashboard");
  }
  return <SignInView />;
}
