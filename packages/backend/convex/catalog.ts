// Compatibility endpoint for backfill jobs that may already have been scheduled
// before the catalog was retired. It deliberately performs no writes. Remove
// this file only after verifying that the deployment's scheduler is drained.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const backfillFromExisting = internalMutation({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.null(),
  handler: async () => null,
});
