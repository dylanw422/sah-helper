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

  pdfTemplates: defineTable({
    key: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.number(),
    // PDF AcroForm field name → PacketData key. Generated automatically by
    // AI on upload (templateMapping.mapTemplateFields). Absent while mapping
    // is in flight.
    fieldMap: v.optional(v.record(v.string(), v.string())),
  }).index("by_key", ["key"]),
});
