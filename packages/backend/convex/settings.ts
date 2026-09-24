import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { MAX_GRANT_AMOUNT } from "./lib/grant";

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
    maximumInvoiceAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.maximumInvoiceAmount !== undefined &&
        (!Number.isFinite(args.maximumInvoiceAmount) || args.maximumInvoiceAmount <= 0 ||
          Math.abs(Math.round(args.maximumInvoiceAmount * 100) - args.maximumInvoiceAmount * 100) > 0.000001)) {
      throw new ConvexError("Maximum invoice amount must be a positive dollar amount with at most two decimal places.");
    }
    const workspaceId = await requireAuth(ctx);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .first();
    const maximumInvoiceAmount = args.maximumInvoiceAmount ?? existing?.maximumInvoiceAmount ?? MAX_GRANT_AMOUNT;
    if (existing) {
      await ctx.db.replace(existing._id, { ...args, maximumInvoiceAmount, workspaceId });
      return existing._id;
    }
    return await ctx.db.insert("settings", { ...args, maximumInvoiceAmount, workspaceId });
  },
});
