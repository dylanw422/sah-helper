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
http.route({ path: "/field-photo", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: uploadHeaders })) });
http.route({
  path: "/field-photo", method: "POST",
  handler: httpAction(async (ctx, request) => {
    let storageId;
    try {
      const token = new URL(request.url).searchParams.get("token");
      if (!token || token.length > 200) throw new Error("Invalid upload link");
      const ticket = await ctx.runMutation(internal.field.consumePhotoUpload, { token });
      const contentType = request.headers.get("Content-Type")?.split(";")[0];
      if (!contentType || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Upload a JPEG, PNG, or WebP photo.");
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Photo is empty.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Photo must be under 8 MB."); }
        chunks.push(value);
      }
      const blob = new Blob(chunks as BlobPart[], { type: contentType });
      const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => header[i] === n);
      const webp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
      if (!(contentType === "image/jpeg" ? jpeg : contentType === "image/png" ? png : webp)) throw new Error("This file is not a supported photo.");
      storageId = await ctx.storage.store(blob);
      const id = await ctx.runMutation(internal.field.finishPhotoUpload, { ticket, storageId, contentType: contentType as "image/jpeg" | "image/png" | "image/webp" });
      return Response.json({ id }, { headers: uploadHeaders });
    } catch {
      if (storageId) await ctx.storage.delete(storageId);
      return new Response("Photo could not be uploaded. Check that it is a JPEG, PNG, or WebP under 8 MB and request a new upload link.", { status: 400, headers: uploadHeaders });
    }
  }),
});
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
