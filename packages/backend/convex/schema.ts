import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const lineItemValidator = v.object({
  description: v.string(),
  qty: v.number(),
  unitPrice: v.number(),
  amount: v.number(),
});

export const standardPacketDocumentKeyValidator = v.union(
  v.literal("va-addendum"), v.literal("scope-of-work"),
  v.literal("construction-stage-completion"), v.literal("lien-release"),
  v.literal("invoice"), v.literal("payment-schedule"),
);

export const fieldStageStatus = v.union(v.literal("not_started"), v.literal("in_progress"),
  v.literal("submitted"), v.literal("verified"), v.literal("changes_requested"));
export const drawWorkStageValidator = v.object({ drawNumber: v.number(), items: v.array(v.object({ lineItemIndex: v.number(), description: v.string() })) });

export default defineSchema({
  fieldProjectLinks: defineTable({
    workspaceId: v.optional(v.id("workspaces")), clientId: v.id("clients"),
    label: v.string(), tokenHash: v.string(), createdAt: v.number(), revokedAt: v.optional(v.number()),
  }).index("by_tokenHash", ["tokenHash"]).index("by_clientId", ["clientId"]),
  // Retain records from the earlier account invitation flow; project access
  // now uses fieldProjectLinks exclusively.
  fieldUsers: defineTable({
    authUserId: v.string(), email: v.string(), name: v.string(), createdAt: v.number(),
  }).index("by_authUserId", ["authUserId"]),
  fieldAssignments: defineTable({
    workspaceId: v.optional(v.id("workspaces")), clientId: v.id("clients"),
    fieldUserId: v.id("fieldUsers"), active: v.boolean(), assignedAt: v.number(),
  }).index("by_clientId", ["clientId"])
    .index("by_fieldUserId_and_active", ["fieldUserId", "active"])
    .index("by_clientId_and_fieldUserId", ["clientId", "fieldUserId"]),
  fieldInvitations: defineTable({
    workspaceId: v.optional(v.id("workspaces")), clientId: v.id("clients"),
    email: v.string(), tokenHash: v.string(), expiresAt: v.number(), createdAt: v.number(),
    acceptedBy: v.optional(v.id("fieldUsers")), revokedAt: v.optional(v.number()),
  }).index("by_tokenHash", ["tokenHash"]).index("by_clientId", ["clientId"]),
  projectStages: defineTable({
    workspaceId: v.optional(v.id("workspaces")), clientId: v.id("clients"),
    title: v.string(), instructions: v.string(), order: v.number(), status: fieldStageStatus,
    dueDate: v.optional(v.string()), blocker: v.optional(v.string()),
    reviewNote: v.optional(v.string()), updatedAt: v.number(),
    drawNumber: v.optional(v.number()), scheduleKey: v.optional(v.string()), archived: v.optional(v.boolean()),
  }).index("by_clientId_and_order", ["clientId", "order"]),
  projectTasks: defineTable({
    clientId: v.id("clients"), stageId: v.id("projectStages"), label: v.string(),
    kind: v.union(v.literal("field"), v.literal("office")), requiresPhoto: v.boolean(),
    order: v.number(), completed: v.boolean(), updatedAt: v.number(),
    completedBy: v.optional(v.string()),
    scheduleItemKey: v.optional(v.string()), retired: v.optional(v.boolean()),
  }).index("by_stageId_and_order", ["stageId", "order"]).index("by_clientId", ["clientId"]),
  projectFiles: defineTable({
    workspaceId: v.optional(v.id("workspaces")), clientId: v.id("clients"),
    stageId: v.optional(v.id("projectStages")), taskId: v.optional(v.id("projectTasks")),
    storageId: v.id("_storage"), filename: v.string(), contentType: v.string(),
    kind: v.union(v.literal("photo"), v.literal("document")),
    uploadedBy: v.string(), uploadedByName: v.string(), createdAt: v.number(),
  }).index("by_clientId", ["clientId"]).index("by_taskId", ["taskId"]),
  fieldUploadTickets: defineTable({
    tokenHash: v.string(), clientId: v.id("clients"), taskId: v.id("projectTasks"),
    authUserId: v.string(), actorName: v.string(), filename: v.string(),
    fieldUserId: v.optional(v.id("fieldUsers")), officeMemberId: v.optional(v.id("authorizedUsers")),
    projectLinkId: v.optional(v.id("fieldProjectLinks")),
    expiresAt: v.number(),
  }).index("by_tokenHash", ["tokenHash"]).index("by_clientId", ["clientId"]),
  projectActivity: defineTable({
    workspaceId: v.optional(v.id("workspaces")), clientId: v.id("clients"),
    stageId: v.optional(v.id("projectStages")), actorId: v.string(), actorName: v.string(),
    type: v.string(), message: v.string(), createdAt: v.number(),
  }).index("by_clientId_and_createdAt", ["clientId", "createdAt"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),
  projectNotificationReads: defineTable({
    activityId: v.id("projectActivity"), authUserId: v.string(),
  }).index("by_authUserId_and_activityId", ["authUserId", "activityId"]).index("by_activityId", ["activityId"]),
  packetDocumentSettings: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    excludedDocuments: v.array(standardPacketDocumentKeyValidator),
  }).index("by_workspaceId", ["workspaceId"]),
  floorPlans: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    clientId: v.id("clients"), draftId: v.string(), name: v.string(), document: v.string(),
    stage: v.optional(v.union(v.literal("before"), v.literal("after"), v.literal("archive"))),
    wallCount: v.number(), fixtureCount: v.number(), revision: v.number(),
    clientCreationRequestId: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_workspaceId_and_draftId", ["workspaceId", "draftId"])
    .index("by_workspaceId_and_updatedAt", ["workspaceId", "updatedAt"])
    .index("by_workspaceId_and_clientId_and_updatedAt", ["workspaceId", "clientId", "updatedAt"]),
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
    drawWorkSchedule: v.optional(v.array(drawWorkStageValidator)),
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

  // Contracts and additional standard packet documents are private to their
  // workspace. Waivers, spec sheets, and job-specific documents are shared.
  // Selected library files
  // are copied into private client packets.
  customDocuments: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    category: v.union(
      v.literal("contract"),
      v.literal("packet-document"),
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
