"use client";

import { api } from "@sah-helper/backend/convex/_generated/api";
import { Button } from "@sah-helper/ui/components/button";
import { Input } from "@sah-helper/ui/components/input";
import { Label } from "@sah-helper/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useAction, useQuery } from "convex/react";
import { LockIcon } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import z from "zod";

import Loader from "@/components/loader";

export default function SetPasswordView() {
  const router = useRouter();
  const status = useQuery(api.users.passwordSetupStatus);
  const setInitialPassword = useAction(api.users.setInitialPassword);

  useEffect(() => {
    if (status && !status.needsSetup) {
      router.replace("/dashboard");
    }
  }, [status, router]);

  const form = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      try {
        await setInitialPassword({ newPassword: value.password });
        toast.success("Password set. Welcome!");
        router.replace("/dashboard");
      } catch {
        toast.error("Could not set password. Please try again.");
      }
    },
    validators: {
      onSubmit: z
        .object({
          password: z.string().min(8, "Password must be at least 8 characters"),
          confirmPassword: z.string(),
        })
        .refine((v) => v.password === v.confirmPassword, {
          message: "Passwords do not match",
          path: ["confirmPassword"],
        }),
    },
  });

  if (status === undefined || !status.needsSetup) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader />
      </div>
    );
  }

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
            <LockIcon className="size-5" />
          </div>
          <span className="text-xl font-semibold tracking-tight">Set Your Password</span>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Before continuing, replace your 6-digit code with a password of your own.
        </p>

        <div className="mx-auto mt-10 w-full max-w-md p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>New Password</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className="text-red-500">
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            <form.Field name="confirmPassword">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Confirm Password</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((error) => (
                    <p key={error?.message} className="text-red-500">
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Saving..." : "Set Password"}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
