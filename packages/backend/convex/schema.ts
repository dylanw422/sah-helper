import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const lineItemValidator = v.object({
  description: v.string(),
  qty: v.number(),
  unitPrice: v.number(),
  amount: v.number(),
});

export default defineSchema({
  clients: defineTable({
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
    status: v.union(v.literal("unsigned"), v.literal("signed"), v.literal("complete")),
    packetStorageId: v.optional(v.id("_storage")),
    // True when files were added/removed since the merged Packet.pdf was built
    packetDirty: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  invoices: defineTable({
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
    total: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updatedAt", ["updatedAt"]),

  clientFiles: defineTable({
    clientId: v.id("clients"),
    storageId: v.id("_storage"),
    filename: v.string(),
    type: v.union(v.literal("generated"), v.literal("uploaded")),
    order: v.number(),
    addedAt: v.number(),
  })
    .index("by_clientId", ["clientId"])
    .index("by_clientId_type", ["clientId", "type"]),

  settings: defineTable({
    contractorCompanyName: v.string(),
    contractorName: v.string(),
    contractorStreet: v.string(),
    contractorCity: v.string(),
    contractorState: v.string(),
    contractorZip: v.string(),
    contractorPhone: v.string(),
    contractorEmail: v.string(),
    contractorLicense: v.string(),
  }),

  authorizedUsers: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    // 6-digit first-login code; doubles as the initial password. Cleared
    // once the user sets a real password.
    code: v.optional(v.string()),
    passwordSet: v.boolean(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  pdfTemplates: defineTable({
    key: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.number(),
    // PDF AcroForm field name → PacketData key. Generated automatically by
    // AI on upload (templateMapping.mapTemplateFields). Absent while mapping
    // is in flight.
    fieldMap: v.optional(v.record(v.string(), v.string())),
  }).index("by_key", ["key"]),

  // User-uploaded document library. Contracts are AI field-mapped and always
  // merged into every packet; waivers and spec sheets are immutable PDFs
  // selected per-packet on the Verify step.
  customDocuments: defineTable({
    category: v.union(v.literal("contract"), v.literal("waiver"), v.literal("spec-sheet")),
    displayName: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.number(),
    // Only present for category "contract". Absent while mapping is in
    // flight; {} if the PDF has no AcroForm fields.
    fieldMap: v.optional(v.record(v.string(), v.string())),
  }).index("by_category", ["category"]),

  // Pricing catalog — one row per distinct piece of work/material, learned
  // automatically from saved invoices and packet clients.
  catalogItems: defineTable({
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
    .index("by_matchKey", ["matchKey"])
    .index("by_lastUsedAt", ["lastUsedAt"]),

  // One observation per source line item — keyed by source so re-saving an
  // invoice never double-counts.
  priceObservations: defineTable({
    catalogItemId: v.id("catalogItems"),
    sourceType: v.union(v.literal("invoice"), v.literal("client"), v.literal("import")),
    sourceId: v.string(),
    description: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    observedAt: v.number(),
  })
    .index("by_sourceType_sourceId", ["sourceType", "sourceId"])
    .index("by_catalogItemId", ["catalogItemId"]),

  // One row per confirmed PDF import. Used to track import history and enable undo.
  catalogImports: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    itemCount: v.number(),
    total: v.number(),
    importedAt: v.number(),
  })
    .index("by_importedAt", ["importedAt"])
    .index("by_storageId", ["storageId"]),
});
