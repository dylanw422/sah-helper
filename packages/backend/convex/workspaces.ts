import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { currentMembership, requireMembership } from "./lib/workspaces";
import schema from "./schema";

export const requireCurrent = internalQuery({
  args: {},
  returns: v.object({
    ...schema.tables.authorizedUsers.validator.fields,
    _id: v.id("authorizedUsers"),
    _creationTime: v.number(),
  }),
  handler: requireMembership,
});

export const current = query({
  args: {},
  returns: v.union(v.null(), v.object({
    id: v.string(), name: v.string(), role: v.union(v.literal("owner"), v.literal("member")),
  })),
  handler: async (ctx) => {
    const member = await currentMembership(ctx);
    if (!member) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", member.workspaceId),
      )
      .first();
    const workspace = member.workspaceId
      ? await ctx.db.get(member.workspaceId)
      : null;
    return {
      id: member.workspaceId ?? "legacy",
      name:
        settings?.contractorCompanyName ||
        workspace?.name ||
        "Access Innovations",
      role: member.role ?? "owner",
    };
  },
});

export const create = mutation({
  args: {
    companyName: v.string(),
    contractorName: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    license: v.string(),
  },
  returns: v.id("workspaces"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!identity || !user)
      throw new ConvexError("Sign in to create a workspace.");
    const existing = await ctx.db.query("authorizedUsers")
      .withIndex("by_email", q => q.eq("email", user.email.toLowerCase())).unique();
    if (existing)
      throw new ConvexError("Your account already belongs to a workspace.");
    if (!args.companyName.trim() || !args.contractorName.trim()) {
      throw new ConvexError("Company and contractor names are required.");
    }
    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.companyName.trim(),
      createdAt: Date.now(),
    });
    await ctx.db.insert("authorizedUsers", {
      workspaceId,
      identity: identity.tokenIdentifier,
      role: "owner",
      email: user.email.toLowerCase(),
      name: user.name,
      passwordSet: true,
      createdAt: Date.now(),
    });
    await ctx.db.insert("settings", {
      workspaceId,
      contractorCompanyName: args.companyName.trim(),
      contractorName: args.contractorName.trim(),
      contractorStreet: args.street.trim(),
      contractorCity: args.city.trim(),
      contractorState: args.state.trim(),
      contractorZip: args.zip.trim(),
      contractorPhone: args.phone.trim(),
      contractorEmail: user.email,
      contractorLicense: args.license.trim(),
    });
    return workspaceId;
  },
});
