/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import { expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}
type Test = ReturnType<typeof setup>;

async function account(t: Test, email: string) {
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        email,
        name: email,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: user._id,
        token: email,
        expiresAt: now + 3600_000,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
  return t.withIdentity({
    subject: user._id,
    issuer: "https://test.convex.site",
    sessionId: session._id,
  });
}
const company = (name: string) => ({
  companyName: name,
  contractorName: "Alex Contractor",
  street: "10 Main",
  city: "Austin",
  state: "TX",
  zip: "78701",
  phone: "555-0100",
  license: "ABC",
});
const invoice = {
  name: "Private Client",
  street: "20 Main",
  city: "Austin",
  state: "TX",
  zip: "78701",
  phone: "555-0200",
  invoiceNumber: "INV-2026-001",
  caseNumber: "123",
  invoiceDate: "2026-09-10",
  lineItems: [{ description: "Ramp", qty: 1, unitPrice: 100, amount: 100 }],
};
async function file(t: Test, workspaceId?: Id<"workspaces">) {
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["private file"])),
  );
  await t.mutation(internal.uploads.registerGenerated, {
    storageId,
    workspaceId,
  });
  return storageId;
}

test("new accounts have no data access until onboarding and cannot create a second workspace", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  expect(await a.query(api.workspaces.current)).toBeNull();
  await expect(a.query(api.clients.listClients)).rejects.toThrow(
    "Create a workspace",
  );
  await expect(t.query(api.clients.listClients)).rejects.toThrow(
    "Not authenticated",
  );
  await a.mutation(api.workspaces.create, company("Company A"));
  expect(await a.query(api.workspaces.current)).toMatchObject({
    name: "Company A",
    role: "owner",
  });
  await expect(
    a.mutation(api.workspaces.create, company("Company B")),
  ).rejects.toThrow("already belongs");
});

test("clients, invoices, settings, pricing and direct IDs are isolated in both directions", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const b = await account(t, "b@example.com");
  const wa = await a.mutation(api.workspaces.create, company("Company A"));
  await b.mutation(api.workspaces.create, company("Company B"));
  const id = await a.mutation(api.invoiceBuilder.saveInvoice, invoice);
  const storageId = await file(t, wa);
  const { invoiceDate, ...clientData } = invoice;
  const clientId = await a.mutation(api.clients.createClient, {
    ...clientData,
    drawCount: 4,
    subtotal: 100,
    total: 100,
    packetStorageId: storageId,
  });
  expect(await a.query(api.clients.listClients)).toHaveLength(1);
  expect(await b.query(api.clients.listClients)).toEqual([]);
  expect(await b.query(api.invoiceBuilder.listInvoices)).toEqual([]);
  expect(await b.query(api.catalog.listItems)).toEqual([]);
  expect(await b.query(api.settings.getSettings)).toMatchObject({
    contractorCompanyName: "Company B",
  });
  await expect(b.query(api.clients.getClient, { clientId })).rejects.toThrow(
    "workspace",
  );
  await expect(
    b.query(api.clients.getPacketDownloadUrl, { clientId }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.clients.updateClientStatus, { clientId, status: "signed" }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.clients.deleteClient, { clientId }),
  ).rejects.toThrow("workspace");
  await expect(
    b.query(api.clientFiles.listClientFiles, { clientId }),
  ).rejects.toThrow("workspace");
  await expect(b.query(api.invoiceBuilder.getInvoice, { id })).rejects.toThrow(
    "workspace",
  );
  await expect(
    b.mutation(api.invoiceBuilder.saveInvoice, { ...invoice, id }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.invoiceBuilder.deleteInvoice, { id }),
  ).rejects.toThrow("workspace");
  const [item] = await a.query(api.catalog.listItems);
  await expect(
    b.mutation(api.catalog.deleteItem, { id: item._id }),
  ).rejects.toThrow("workspace");
  await b.mutation(api.catalog.triggerBackfill);
  expect(await a.query(api.catalog.listItems)).toHaveLength(1);
  const bid = await b.mutation(api.invoiceBuilder.saveInvoice, {
    ...invoice,
    lineItems: [{ description: "Ramp", qty: 1, unitPrice: 900, amount: 900 }],
  });
  expect((await a.query(api.catalog.listItems))[0].lastUnitPrice).toBe(100);
  expect((await b.query(api.catalog.listItems))[0].lastUnitPrice).toBe(900);
  await expect(
    a.query(api.invoiceBuilder.getInvoice, { id: bid }),
  ).rejects.toThrow("workspace");
});

test("files cannot be parsed, attached, imported or registered in another workspace", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const b = await account(t, "b@example.com");
  const wa = await a.mutation(api.workspaces.create, company("A"));
  await b.mutation(api.workspaces.create, company("B"));
  const storageId = await file(t, wa);
  const id = await t.run(ctx => ctx.db.insert("customDocuments", {
    workspaceId: wa,
    storageId,
    category: "contract",
    displayName: "Private contract",
    uploadedAt: Date.now(),
  }));
  expect(await b.query(api.customDocuments.listCustomDocuments, {})).toEqual(
    [],
  );
  await expect(
    b.query(api.customDocuments.getCustomDocumentUrl, { id }),
  ).rejects.toThrow("workspace");
  await expect(
    b.action(api.customDocuments.inspectCustomDocument, { id }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.customDocuments.deleteCustomDocument, { id }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.customDocuments.registerCustomDocument, {
      storageId,
      category: "waiver",
      displayName: "stolen",
    }),
  ).rejects.toThrow("workspace");
  await expect(
    b.action(api.invoices.parseInvoice, { storageId }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.catalog.confirmImport, {
      storageId,
      fileName: "stolen",
      lineItems: [],
    }),
  ).rejects.toThrow("workspace");
  await expect(
    b.mutation(api.templates.registerTemplate, {
      storageId,
      key: "va-addendum",
    }),
  ).rejects.toThrow("workspace");
});

test.each(["waiver", "spec-sheet", "job-specific"] as const)(
  "%s library documents are shared for existing and new workspaces, with deletion limited to the uploader",
  async category => {
    const t = setup();
    const a = await account(t, "a@example.com");
    const b = await account(t, "b@example.com");
    const newcomer = await account(t, "not-onboarded@example.com");
    const wa = await a.mutation(api.workspaces.create, company("A"));
    const wb = await b.mutation(api.workspaces.create, company("B"));
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const stored = await t.run(async ctx => ({
      legacy: await ctx.storage.store(new Blob([bytes as BlobPart])),
      a: await ctx.storage.store(new Blob([bytes as BlobPart])),
      b: await ctx.storage.store(new Blob([bytes as BlobPart])),
    }));
    await t.mutation(internal.uploads.registerGenerated, { storageId: stored.a, workspaceId: wa });
    await t.mutation(internal.uploads.registerGenerated, { storageId: stored.b, workspaceId: wb });
    const legacyId = await t.run(ctx => ctx.db.insert("customDocuments", {
      category, storageId: stored.legacy, displayName: "Existing document", uploadedAt: 1,
    }));
    const aId = await a.mutation(api.customDocuments.registerCustomDocument, {
      category, storageId: stored.a, displayName: "A document",
    });
    const bId = await b.mutation(api.customDocuments.registerCustomDocument, {
      category, storageId: stored.b, displayName: "B document",
    });
    for (const viewer of [a, b]) {
      expect((await viewer.query(api.customDocuments.listCustomDocuments, { category })).map(doc => doc._id).sort())
        .toEqual([legacyId, aId, bId].sort());
      expect(await viewer.query(api.customDocuments.listCustomDocuments, {})).toHaveLength(3);
      expect(await viewer.query(internal.customDocuments.listCustomDocumentsInternal, { category })).toHaveLength(3);
      // Packet generation resolves selected library files through this endpoint.
      for (const id of [legacyId, aId, bId]) {
        expect(await viewer.query(api.customDocuments.getCustomDocument, { id })).toMatchObject({ _id: id, category });
        expect(await viewer.query(api.customDocuments.getCustomDocumentUrl, { id })).toBeTruthy();
      }
    }
    expect(await b.action(api.customDocuments.inspectCustomDocument, { id: aId })).toEqual([]);
    await expect(b.mutation(api.customDocuments.deleteCustomDocument, { id: aId })).rejects.toThrow("workspace");
    await expect(a.mutation(api.customDocuments.deleteCustomDocument, { id: legacyId })).rejects.toThrow("workspace");
    await expect(t.query(api.customDocuments.getCustomDocumentUrl, { id: aId })).rejects.toThrow("Not authenticated");
    await expect(newcomer.query(api.customDocuments.listCustomDocuments, { category })).rejects.toThrow("Create a workspace");
    // Sharing a library document does not grant access to arbitrary raw files.
    await expect(b.query(internal.uploads.checkFile, { storageId: stored.a })).rejects.toThrow("workspace");
    await a.mutation(api.customDocuments.deleteCustomDocument, { id: aId });
    expect(await b.query(api.customDocuments.listCustomDocuments, { category })).toHaveLength(2);
  },
);

test("existing unscoped data stays with Access Innovations and base forms remain available", async () => {
  const t = setup();
  const legacy = await account(t, "existing@example.com");
  const a = await account(t, "new@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("authorizedUsers", {
      email: "existing@example.com",
      passwordSet: true,
      createdAt: 1,
    });
    await ctx.db.insert("invoices", {
      ...invoice,
      total: 100,
      createdAt: 1,
      updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob(["blank form"]));
    await ctx.db.insert("pdfTemplates", {
      key: "va-addendum",
      storageId,
      uploadedAt: 1,
    });
  });
  await a.mutation(api.workspaces.create, company("New"));
  expect(await legacy.query(api.invoiceBuilder.listInvoices)).toHaveLength(1);
  expect(await a.query(api.invoiceBuilder.listInvoices)).toEqual([]);
  expect(
    (await a.query(api.templates.listTemplates)).find(
      (t) => t.key === "va-addendum",
    )?.uploaded,
  ).toBe(true);
  expect(await a.query(api.users.listUsers)).toHaveLength(1);
  expect((await legacy.query(api.users.listUsers))[0].email).toBe(
    "existing@example.com",
  );
});

test("membership removal blocks an active session and upload tickets are single use", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const workspaceId = await a.mutation(api.workspaces.create, company("A"));
  const url = await a.mutation(api.uploads.generateUploadUrl);
  const token = new URL(url).searchParams.get("token")!;
  expect(await t.mutation(internal.uploads.consumeTicket, { token })).toEqual({
    workspaceId,
  });
  await expect(
    t.mutation(internal.uploads.consumeTicket, { token }),
  ).rejects.toThrow("expired");
  await t.run(async (ctx) => {
    const member = await ctx.db.query("authorizedUsers").first();
    await ctx.db.delete(member!._id);
  });
  await expect(a.query(api.clients.listClients)).rejects.toThrow(
    "Create a workspace",
  );
});

test("team members cannot administer users and owners cannot remove another company's users", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const b = await account(t, "b@example.com");
  await a.mutation(api.workspaces.create, company("A"));
  await b.mutation(api.workspaces.create, company("B"));
  const [bOwner] = await b.query(api.users.listUsers);
  await expect(
    a.action(api.users.removeUser, { id: bOwner._id }),
  ).rejects.toThrow("workspace");
  await t.run(async (ctx) => {
    const member = await ctx.db
      .query("authorizedUsers")
      .withIndex("by_email", (q) => q.eq("email", "b@example.com"))
      .unique();
    await ctx.db.patch(member!._id, { role: "member" });
  });
  expect(await b.query(api.users.listUsers)).toEqual([]);
  await expect(
    b.action(api.users.addUser, { email: "new@example.com", name: "New" }),
  ).rejects.toThrow("administrators");
  await expect(
    b.action(api.users.removeUser, { id: bOwner._id }),
  ).rejects.toThrow("administrators");
});

test("a company's template override never replaces another company's base form", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const b = await account(t, "b@example.com");
  const wa = await a.mutation(api.workspaces.create, company("A"));
  await b.mutation(api.workspaces.create, company("B"));
  const baseId = await file(t);
  const ownId = await file(t, wa);
  await t.run(async (ctx) => {
    await ctx.db.insert("pdfTemplates", {
      key: "va-addendum",
      storageId: baseId,
      uploadedAt: 1,
    });
    await ctx.db.insert("pdfTemplates", {
      workspaceId: wa,
      key: "va-addendum",
      storageId: ownId,
      uploadedAt: 2,
    });
  });
  expect(
    (await a.query(api.templates.listTemplates)).find(
      (t) => t.key === "va-addendum",
    )?.storageId,
  ).toBe(ownId);
  expect(
    (await b.query(api.templates.listTemplates)).find(
      (t) => t.key === "va-addendum",
    )?.storageId,
  ).toBe(baseId);
});

test("HTTP upload records ownership and rejects token reuse", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const b = await account(t, "b@example.com");
  await a.mutation(api.workspaces.create, company("A"));
  await b.mutation(api.workspaces.create, company("B"));
  const url = new URL(await a.mutation(api.uploads.generateUploadUrl));
  const response = await t.fetch(url.pathname + url.search, {
    method: "POST",
    body: "PDF content",
    headers: { "Content-Type": "application/pdf" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "http://localhost:3001",
  );
  const { storageId } = await response.json();
  await expect(
    a.query(internal.uploads.checkFile, { storageId }),
  ).resolves.toBeNull();
  await expect(
    b.query(internal.uploads.checkFile, { storageId }),
  ).rejects.toThrow("workspace");
  expect(
    (
      await t.fetch(url.pathname + url.search, {
        method: "POST",
        body: "retry",
      })
    ).status,
  ).toBe(400);
});

test("generated invoices use company settings and register files to their workspace", async () => {
  const t = setup();
  const a = await account(t, "a@example.com");
  const b = await account(t, "b@example.com");
  await a.mutation(api.workspaces.create, company("A"));
  await b.mutation(api.workspaces.create, company("B"));
  const result = await a.action(api.invoiceBuilder.buildInvoice, invoice);
  expect(result.url).toBeTruthy();
  await expect(
    a.query(internal.uploads.checkFile, { storageId: result.storageId }),
  ).resolves.toBeNull();
  await expect(
    b.query(internal.uploads.checkFile, { storageId: result.storageId }),
  ).rejects.toThrow("workspace");
});

test("public registration creates an account without granting legacy membership", async () => {
  const t = setup();
  const signup = (email: string) => t.fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" },
    body: JSON.stringify({ email, name: "New contractor", password: "a-strong-test-password" }),
  });
  const response = await signup("new@example.com");
  expect(response.status).toBe(200);
  expect(await t.run(ctx => ctx.db.query("authorizedUsers").take(10))).toEqual([]);
  await t.run(ctx => ctx.db.insert("authorizedUsers", { email: "reserved@example.com", passwordSet: true, createdAt: 1 }));
  expect((await signup("reserved@example.com")).status).toBe(403);
});

test("owners can provision a staff account in their workspace", async () => {
  const t = setup();
  const a = await account(t, "owner@example.com");
  await a.mutation(api.workspaces.create, company("A"));
  const result = await a.action(api.users.addUser, { email: "staff@example.com", name: "Staff" });
  expect(result.code).toMatch(/^\d{6}$/);
  const users = await a.query(api.users.listUsers);
  expect(users.map(u => u.email).sort()).toEqual(["owner@example.com", "staff@example.com"]);
  const staff = await t.run(ctx => ctx.db.query("authorizedUsers").withIndex("by_email", q => q.eq("email", "staff@example.com")).unique());
  expect(staff?.role).toBe("member");
  expect(staff?.authUserId).toBeTruthy();
});
