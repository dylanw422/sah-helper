import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { APIError } from "better-auth/api";

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
          before: async (user) => {
            // Public registration must never claim an existing legacy membership.
            if (!("runQuery" in ctx)) throw new APIError("FORBIDDEN");
            const reserved = await ctx.runQuery(
              internal.users.isEmailAuthorized,
              { email: user.email.toLowerCase() },
            );
            if (reserved)
              throw new APIError("FORBIDDEN", {
                message:
                  "This email already has workspace access. Please sign in.",
              });
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
