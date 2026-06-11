"use client";

import { FileTextIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function SignInView() {
  const [showSignIn, setShowSignIn] = useState(true);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="mb-2 flex items-center justify-center gap-2">
          <div className="flex size-9 items-center justify-center bg-primary text-primary-foreground">
            <FileTextIcon className="size-5" />
          </div>
          <span className="text-xl font-semibold tracking-tight">SAH Helper</span>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          VA SAH grant packet automation
        </p>
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </motion.div>
    </div>
  );
}
