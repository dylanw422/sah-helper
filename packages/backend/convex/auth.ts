import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      // 6-digit first-login codes act as the initial password
      minPasswordLength: 6,
    },
    databaseHooks: {
      user: {
        create: {
          // Lock the app to invited users: reject account creation for any
          // email not present in the authorizedUsers table.
          before: async (user) => {
            if (!("runQuery" in ctx)) {
              throw new APIError("FORBIDDEN", { message: "Sign up is disabled" });
            }
            const allowed = await ctx.runQuery(internal.users.isEmailAuthorized, {
              email: user.email.toLowerCase(),
            });
            if (!allowed) {
              throw new APIError("FORBIDDEN", { message: "Sign up is disabled" });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});
