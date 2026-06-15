import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { requireAuth } from "./lib/auth";

function generateCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(100000 + (n % 900000));
}

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const rows = await ctx.db.query("authorizedUsers").order("desc").take(200);
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      name: r.name ?? null,
      passwordSet: r.passwordSet,
      code: r.passwordSet ? null : (r.code ?? null),
      createdAt: r.createdAt,
    }));
  },
});

export const passwordSetupStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user?.email) return { needsSetup: false };
    const row = await ctx.db
      .query("authorizedUsers")
      .withIndex("by_email", (q) => q.eq("email", user.email.toLowerCase()))
      .unique();
    return { needsSetup: !!row && !row.passwordSet };
  },
});

export const addUser = action({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const email = args.email.trim().toLowerCase();
    const name = args.name.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Invalid email address");
    }
    if (!name) {
      throw new Error("Name is required");
    }
    const existing = await ctx.runQuery(internal.users.getByEmail, { email });
    if (existing) {
      throw new Error("This user has already been added");
    }

    const code = generateCode();
    await ctx.runMutation(internal.users.insertAuthorizedUser, { email, name, code });
    try {
      await createAuth(ctx).api.signUpEmail({
        body: {
          email,
          password: code,
          name,
        },
      });
    } catch (err) {
      await ctx.runMutation(internal.users.removeByEmail, { email });
      throw new Error("Could not create user. They may already have an account.");
    }
    return { code };
  },
});

export const removeUser = action({
  args: { id: v.id("authorizedUsers") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const row = await ctx.runQuery(internal.users.getById, { id: args.id });
    if (!row) return null;

    const me = await authComponent.getAuthUser(ctx);
    if (me.email.toLowerCase() === row.email) {
      throw new Error("You cannot remove your own account");
    }

    const authCtx = await createAuth(ctx).$context;
    const found = await authCtx.internalAdapter.findUserByEmail(row.email);
    if (found) {
      // Cascades: sessions -> accounts -> user
      await authCtx.internalAdapter.deleteUser(found.user.id);
    }
    await ctx.runMutation(internal.users.removeByEmail, { email: row.email });
    return null;
  },
});

export const setInitialPassword = action({
  args: { newPassword: v.string() },
  handler: async (ctx, args) => {
    if (args.newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const user = await authComponent.getAuthUser(ctx);
    const row = await ctx.runQuery(internal.users.getByEmail, {
      email: user.email.toLowerCase(),
    });
    if (!row || row.passwordSet || !row.code) {
      throw new Error("Password has already been set");
    }
    await createAuth(ctx).api.changePassword({
      body: {
        currentPassword: row.code,
        newPassword: args.newPassword,
        revokeOtherSessions: false,
      },
      headers: await authComponent.getHeaders(ctx),
    });
    await ctx.runMutation(internal.users.markPasswordSet, { id: row._id });
    return null;
  },
});

export const isEmailAuthorized = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("authorizedUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    return row !== null;
  },
});

export const getById = internalQuery({
  args: { id: v.id("authorizedUsers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authorizedUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
  },
});

export const insertAuthorizedUser = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()), code: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("authorizedUsers", {
      email: args.email,
      name: args.name,
      code: args.code,
      passwordSet: false,
      createdAt: Date.now(),
    });
  },
});

export const removeByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("authorizedUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const markPasswordSet = internalMutation({
  args: { id: v.id("authorizedUsers") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { passwordSet: true, code: undefined });
  },
});
