import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { storeWorkspaceFile } from "./lib/files";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

const uploadHeaders = {
  "Access-Control-Allow-Origin": process.env.SITE_URL!,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};
http.route({
  path: "/workspace-upload",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: uploadHeaders }),
  ),
});
http.route({
  path: "/workspace-upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const token = new URL(request.url).searchParams.get("token");
      if (!token)
        return new Response("Missing upload token", {
          status: 401,
          headers: uploadHeaders,
        });
      const ticket = await ctx.runMutation(internal.uploads.consumeTicket, {
        token,
      });
      const blob = await request.blob();
      if (blob.size > 20 * 1024 * 1024)
        return new Response("File must be under 20 MB", {
          status: 413,
          headers: uploadHeaders,
        });
      const storageId = await storeWorkspaceFile(ctx, blob, ticket.workspaceId);
      return Response.json({ storageId }, { headers: uploadHeaders });
    } catch {
      return new Response("Upload failed. Please request a new upload link.", {
        status: 400,
        headers: uploadHeaders,
      });
    }
  }),
});

export default http;
