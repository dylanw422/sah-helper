import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireAuth(ctx);
    return await ctx.db
      .query("settings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .first();
  },
});

export const updateSettings = mutation({
  args: {
    contractorCompanyName: v.string(),
    contractorName: v.string(),
    contractorStreet: v.string(),
    contractorCity: v.string(),
    contractorState: v.string(),
    contractorZip: v.string(),
    contractorPhone: v.string(),
    contractorEmail: v.string(),
    contractorLicense: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireAuth(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, { ...args, workspaceId });
      return existing._id;
    }
    return await ctx.db.insert("settings", { ...args, workspaceId });
  },
});
