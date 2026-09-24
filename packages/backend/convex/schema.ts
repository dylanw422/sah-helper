import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const lineItemValidator = v.object({
  description: v.string(),
  qty: v.number(),
  unitPrice: v.number(),
  amount: v.number(),
});

export default defineSchema({
  workspaces: defineTable({ name: v.string(), createdAt: v.number() }),
  workspaceFiles: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    storageId: v.id("_storage"),
  }).index("by_storageId", ["storageId"]),
  uploadTickets: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
  clients: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.optional(v.string()),
    drawCount: v.union(v.literal(4), v.literal(5), v.literal(6)),
    lineItems: v.array(lineItemValidator),
    subtotal: v.number(),
    total: v.number(),
    status: v.union(
      v.literal("unsigned"),
      v.literal("signed"),
      v.literal("complete"),
    ),
    packetStorageId: v.optional(v.id("_storage")),
    // True when files were added/removed since the merged Packet.pdf was built
    packetDirty: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),

  invoices: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    caseNumber: v.string(),
    // Raw yyyy-mm-dd input value; formatted for display only at PDF time
    invoiceDate: v.string(),
    // Last item is always the Profit row (qty = percentage)
    lineItems: v.array(lineItemValidator),
    waiverIds: v.optional(v.array(v.id("customDocuments"))),
    specSheetIds: v.optional(v.array(v.id("customDocuments"))),
    jobSpecificIds: v.optional(v.array(v.id("customDocuments"))),
    total: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_workspaceId_and_updatedAt", ["workspaceId", "updatedAt"]),

  clientFiles: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    clientId: v.id("clients"),
    storageId: v.id("_storage"),
    filename: v.string(),
    type: v.union(v.literal("generated"), v.literal("uploaded")),
    order: v.number(),
    addedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_clientId", ["clientId"])
    .index("by_workspaceId_and_clientId", ["workspaceId", "clientId"])
    .index("by_clientId_type", ["clientId", "type"])
    .index("by_workspaceId_and_clientId_type", [
      "workspaceId",
      "clientId",
      "type",
    ]),

  settings: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    maximumInvoiceAmount: v.optional(v.number()),
    contractorCompanyName: v.string(),
    contractorName: v.string(),
    contractorStreet: v.string(),
    contractorCity: v.string(),
    contractorState: v.string(),
    contractorZip: v.string(),
    contractorPhone: v.string(),
    contractorEmail: v.string(),
    contractorLicense: v.string(),
  }).index("by_workspaceId", ["workspaceId"]),

  authorizedUsers: defineTable({
    authUserId: v.optional(v.string()),
    identity: v.optional(v.string()),
    role: v.optional(v.union(v.literal("owner"), v.literal("member"))),
    workspaceId: v.optional(v.id("workspaces")),
    email: v.string(),
    name: v.optional(v.string()),
    // 6-digit first-login code; doubles as the initial password. Cleared
    // once the user sets a real password.
    code: v.optional(v.string()),
    passwordSet: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_email", ["email"]),

  pdfTemplates: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    key: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.number(),
    // PDF AcroForm field name → PacketData key. Generated automatically by
    // AI on upload (templateMapping.mapTemplateFields). Absent while mapping
    // is in flight.
    fieldMap: v.optional(v.record(v.string(), v.string())),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_key", ["key"])
    .index("by_workspaceId_and_key", ["workspaceId", "key"]),

  // Contracts are private to their workspace. Waivers, spec sheets, and
  // job-specific documents are shared across workspaces; workspaceId records
  // the uploader's workspace for deletion permissions. Selected library files
  // are copied into private client packets.
  customDocuments: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    category: v.union(
      v.literal("contract"),
      v.literal("waiver"),
      v.literal("spec-sheet"),
      v.literal("job-specific"),
    ),
    displayName: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.number(),
    // Only present for category "contract". Absent while mapping is in
    // flight; {} if the PDF has no AcroForm fields.
    fieldMap: v.optional(v.record(v.string(), v.string())),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_category", ["category"])
    .index("by_workspaceId_and_category", ["workspaceId", "category"]),

  bundles: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    name: v.string(),
    normalizedName: v.string(),
    description: v.string(),
    searchText: v.string(),
    itemCount: v.number(),
    documentCount: v.number(),
    subtotalCents: v.number(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .index("by_workspace_name", ["workspaceId", "normalizedName"])
    .searchIndex("search_bundles", {
      searchField: "searchText",
      filterFields: ["workspaceId"],
    }),
  bundleItems: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    bundleId: v.id("bundles"),
    description: v.string(),
    quantity: v.number(),
    unitPriceCents: v.number(),
    order: v.number(),
  }).index("by_bundle_order", ["bundleId", "order"]),
  bundleDocuments: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    bundleId: v.id("bundles"),
    documentId: v.id("customDocuments"),
    displayNameSnapshot: v.string(),
    categorySnapshot: v.union(
      v.literal("waiver"),
      v.literal("spec-sheet"),
      v.literal("job-specific"),
    ),
    order: v.number(),
  }).index("by_bundle_order", ["bundleId", "order"]),

  // Pricing catalog — one row per distinct piece of work/material, learned
  // automatically from saved invoices and packet clients.
  catalogItems: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    canonicalDescription: v.string(),
    // Lowercased, trimmed, whitespace-collapsed, punctuation-stripped description.
    matchKey: v.string(),
    area: v.optional(v.string()),
    unit: v.optional(v.string()),
    lastUnitPrice: v.number(),
    avgUnitPrice: v.number(),
    minUnitPrice: v.number(),
    maxUnitPrice: v.number(),
    occurrences: v.number(),
    lastUsedAt: v.number(),
    // When true, manualUnitPrice is used as the representative price for AI
    // generation instead of lastUnitPrice. Not overwritten by stat recompute.
    priceLocked: v.optional(v.boolean()),
    manualUnitPrice: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_matchKey", ["matchKey"])
    .index("by_workspaceId_and_matchKey", ["workspaceId", "matchKey"])
    .index("by_lastUsedAt", ["lastUsedAt"])
    .index("by_workspaceId_and_lastUsedAt", ["workspaceId", "lastUsedAt"]),

  // One observation per source line item — keyed by source so re-saving an
  // invoice never double-counts.
  priceObservations: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    catalogItemId: v.id("catalogItems"),
    sourceType: v.union(
      v.literal("invoice"),
      v.literal("client"),
      v.literal("import"),
    ),
    sourceId: v.string(),
    description: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    observedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_sourceType_sourceId", ["sourceType", "sourceId"])
    .index("by_workspaceId_and_sourceType_sourceId", [
      "workspaceId",
      "sourceType",
      "sourceId",
    ])
    .index("by_catalogItemId", ["catalogItemId"])
    .index("by_workspaceId_and_catalogItemId", [
      "workspaceId",
      "catalogItemId",
    ]),

  // One row per confirmed PDF import. Used to track import history and enable undo.
  catalogImports: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    itemCount: v.number(),
    total: v.number(),
    importedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_importedAt", ["importedAt"])
    .index("by_workspaceId_and_importedAt", ["workspaceId", "importedAt"])
    .index("by_storageId", ["storageId"])
    .index("by_workspaceId_and_storageId", ["workspaceId", "storageId"]),
});
