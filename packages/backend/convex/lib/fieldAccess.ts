import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { assertWorkspace, currentMembership } from "./workspaces";

type ReadCtx = QueryCtx | MutationCtx;
export type ProjectActor = {
  authUserId: string; name: string;
} & ({ office: true; member: Doc<"authorizedUsers"> } | { office: false; link: Doc<"fieldProjectLinks"> });

export async function projectActor(ctx: ReadCtx): Promise<ProjectActor> {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw new ConvexError("Sign in to continue.");
  const member = await currentMembership(ctx);
  if (member) return { office: true, member, authUserId: user._id, name: user.name };
  throw new ConvexError("Open the project link shared by your office to continue.");
}

export async function projectLink(ctx: ReadCtx, token: string) {
  if (token.length < 64 || token.length > 200) throw new ConvexError("This project link is no longer available. Ask the office for a new link.");
  const tokenHash = await hashToken(token);
  const link = await ctx.db.query("fieldProjectLinks").withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!link || link.revokedAt || !(await ctx.db.get(link.clientId))) throw new ConvexError("This project link is no longer available. Ask the office for a new link.");
  return link;
}

export async function projectAccess(ctx: ReadCtx, clientId: Id<"clients">, token?: string) {
  // A supplied link always uses field permissions, even for a signed-in office user.
  const link = token !== undefined ? await projectLink(ctx, token) : null;
  const actor: ProjectActor = link ? { office: false, link, authUserId: `link:${link._id}`, name: `${link.label} (project link)` } : await projectActor(ctx);
  const client = await ctx.db.get(clientId);
  if (!client) throw new ConvexError("Project is no longer available.");
  if (actor.office) assertWorkspace(client, actor.member.workspaceId);
  else {
    if (actor.link.clientId !== clientId) throw new ConvexError("This link does not grant access to this project.");
  }
  return { client, actor };
}

export async function stageAccess(ctx: ReadCtx, stageId: Id<"projectStages">, token?: string) {
  const stage = await ctx.db.get(stageId);
  if (!stage) throw new ConvexError("Stage is no longer available.");
  return { ...await projectAccess(ctx, stage.clientId, token), stage };
}

export function editableStage(stage: Doc<"projectStages">) {
  if (stage.status === "submitted" || stage.status === "verified") {
    throw new ConvexError("This stage is under review or verified. The office must return it for changes first.");
  }
}

export function publicProject(client: Doc<"clients">) {
  return { id: client._id, name: client.name, address: [client.street, client.city, client.state, client.zip].filter(Boolean).join(", ") };
}

export async function activity(ctx: MutationCtx, client: Doc<"clients">, actor: Pick<ProjectActor, "authUserId" | "name">,
  type: string, message: string, stageId?: Id<"projectStages">) {
  await ctx.db.insert("projectActivity", {
    workspaceId: client.workspaceId, clientId: client._id, actorId: actor.authUserId,
    actorName: actor.name, type, message, stageId, createdAt: Date.now(),
  });
}

export function cleanText(value: string, label: string, limit = 1000, required = true) {
  const text = value.trim();
  if ((required && !text) || text.length > limit) throw new ConvexError(`${label} must be ${required ? "1" : "0"}–${limit} characters.`);
  return text;
}

export async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
