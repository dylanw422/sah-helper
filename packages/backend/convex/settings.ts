import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.db.query("settings").first();
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
    await requireAuth(ctx);
    const existing = await ctx.db.query("settings").first();
    if (existing) {
      await ctx.db.replace(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("settings", args);
  },
});
