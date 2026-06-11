import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuth } from "./lib/auth";
import { buildDrawSchedule, type DrawSchedule } from "./lib/drawSchedule";
import { fillTemplate, mergeDocuments, mergePdfBytes } from "./lib/pdf";
import { buildFieldValues, type PacketData } from "./lib/pdfFieldMap";
import { DOC_ORDER, getTemplateKey, type DrawCount } from "./lib/templateKeys";
import { TEMPLATE_DISPLAY_NAMES } from "./lib/templateNames";
import { lineItemValidator } from "./schema";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export const generatePacket = action({
  args: {
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
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ clientId: Id<"clients">; packetStorageId: Id<"_storage"> }> => {
    await requireAuth(ctx);

    const settings = await ctx.runQuery(api.settings.getSettings);
    if (!settings) {
      throw new Error("Contractor settings are not configured. Visit Settings before generating packets.");
    }

    const templates = await ctx.runQuery(api.templates.listTemplates);
    const drawCount = args.drawCount as DrawCount;

    const neededKeys = DOC_ORDER.map((doc) => getTemplateKey(doc, drawCount));
    const missing = neededKeys.filter(
      (key) => !templates.find((t) => t.key === key && t.uploaded),
    );
    if (missing.length > 0) {
      throw new Error(`Missing PDF templates: ${missing.join(", ")}. Upload them before generating packets.`);
    }

    const schedule = buildDrawSchedule(args.lineItems, drawCount);
    const { total } = schedule;
    const subtotal = total;

    const clientCityStateZip = `${args.city}, ${args.state} ${args.zip}`;
    const clientAddress = `${args.street}, ${clientCityStateZip}`;
    const contractorAddress = `${settings.contractorStreet}, ${settings.contractorCity}, ${settings.contractorState} ${settings.contractorZip}`;

    const packetData: PacketData = {
      clientName: args.name,
      clientStreet: args.street,
      clientCity: args.city,
      clientState: args.state,
      clientZip: args.zip,
      clientCityStateZip,
      clientAddress,
      clientPhone: args.phone,
      invoiceNumber: args.invoiceNumber,
      caseNumber: args.caseNumber ?? "",
      contractTotal: formatCurrency(total),
      drawCount: String(drawCount),
      contractorCompanyName: settings.contractorCompanyName,
      contractorName: settings.contractorName,
      contractorAddress,
      contractorPhone: settings.contractorPhone,
      contractorEmail: settings.contractorEmail,
      contractorLicense: settings.contractorLicense,
      clientNameAddress: `${args.name}, ${clientAddress}`,
      contractorNameAddress: `${settings.contractorCompanyName}, ${contractorAddress}`,
      ...buildLineItemFields(args.lineItems),
      ...buildDrawFields(schedule, args.lineItems),
    };

    const filledDocs = [];
    for (const key of neededKeys) {
      const template = templates.find((t) => t.key === key)!;
      let fieldMap: Record<string, string> | null = template.fieldMap;
      if (!fieldMap) {
        // Mapping hasn't run for this template yet (upload still processing or
        // pre-dates auto-mapping) — generate and persist it now.
        fieldMap = await ctx.runAction(internal.templateMapping.mapTemplateFields, { key });
      }

      const blob = await ctx.storage.get(template.storageId!);
      if (!blob) throw new Error(`Template file missing from storage: ${key}`);
      const bytes = await blob.arrayBuffer();
      filledDocs.push(await fillTemplate(bytes, buildFieldValues(packetData, fieldMap)));
    }

    const mergedBytes = await mergeDocuments(filledDocs);
    const packetStorageId = await ctx.storage.store(
      new Blob([mergedBytes as BlobPart], { type: "application/pdf" }),
    );

    const clientId: Id<"clients"> = await ctx.runMutation(api.clients.createClient, {
      name: args.name,
      street: args.street,
      city: args.city,
      state: args.state,
      zip: args.zip,
      phone: args.phone,
      invoiceNumber: args.invoiceNumber,
      caseNumber: args.caseNumber,
      drawCount: args.drawCount,
      lineItems: args.lineItems,
      subtotal,
      total,
      packetStorageId,
    });

    // Store each filled document individually so the file drawer can list and
    // re-merge them later.
    for (let i = 0; i < neededKeys.length; i++) {
      const key = neededKeys[i];
      const docBytes = await filledDocs[i].save();
      const individualStorageId = await ctx.storage.store(
        new Blob([docBytes as BlobPart], { type: "application/pdf" }),
      );
      await ctx.runMutation(api.clientFiles.addClientFile, {
        clientId,
        storageId: individualStorageId,
        filename: TEMPLATE_DISPLAY_NAMES[key],
        type: "generated",
        order: i,
      });
    }

    return { clientId, packetStorageId };
  },
});

export const regeneratePacket = action({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args): Promise<{ packetStorageId: Id<"_storage"> }> => {
    await requireAuth(ctx);

    const files = await ctx.runQuery(api.clientFiles.listClientFiles, {
      clientId: args.clientId,
    });
    if (files.length === 0) {
      throw new Error("No files found for this client.");
    }

    const docBytes: ArrayBuffer[] = [];
    for (const file of files) {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) throw new Error(`File missing from storage: ${file.filename}`);
      docBytes.push(await blob.arrayBuffer());
    }

    const mergedBytes = await mergePdfBytes(docBytes);
    const packetStorageId = await ctx.storage.store(
      new Blob([mergedBytes as BlobPart], { type: "application/pdf" }),
    );

    await ctx.runMutation(api.clients.setPacketStorageId, {
      clientId: args.clientId,
      packetStorageId,
      dirty: false,
    });

    return { packetStorageId };
  },
});

function buildDrawFields(
  schedule: DrawSchedule,
  lineItems: { description: string }[],
): Pick<
  PacketData,
  `draw${1 | 2 | 3 | 4 | 5 | 6}Amount` | "finalDrawAmount" | `draw${1 | 2 | 3 | 4 | 5}Description`
> {
  const fields = {} as Record<string, string>;
  for (let i = 1; i <= 6; i++) {
    const amount = schedule.drawAmounts[i - 1];
    fields[`draw${i}Amount`] = amount !== undefined ? formatCurrency(amount) : "";
  }
  fields.finalDrawAmount = formatCurrency(schedule.drawAmounts[schedule.drawAmounts.length - 1]);
  for (let i = 1; i <= 5; i++) {
    const group = schedule.groups[i - 1];
    fields[`draw${i}Description`] = group
      ? group.map((idx) => lineItems[idx].description).join(", ")
      : "";
  }
  return fields as ReturnType<typeof buildDrawFields>;
}

function buildLineItemFields(
  lineItems: { description: string; amount: number }[],
): Pick<PacketData, `lineItem${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}${"Description" | "Amount"}`> {
  const fields = {} as Record<string, string>;
  for (let i = 1; i <= 10; i++) {
    const item = lineItems[i - 1];
    fields[`lineItem${i}Description`] = item?.description ?? "";
    fields[`lineItem${i}Amount`] = item ? formatCurrency(item.amount) : "";
  }
  return fields as ReturnType<typeof buildLineItemFields>;
}
