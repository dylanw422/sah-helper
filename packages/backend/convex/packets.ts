import { v } from "convex/values";
import { PDFDocument } from "pdf-lib";

import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuth } from "./lib/auth";
import { buildDrawSchedule, type DrawSchedule } from "./lib/drawSchedule";
import { fillTemplate, mergeDocuments, mergePdfBytes } from "./lib/pdf";
import { buildFieldValues, buildSizeGroups, type PacketData } from "./lib/pdfFieldMap";
import { buildScopeOfWorkPdf, type ScopeSection } from "./lib/scopeOfWorkPdf";
import {
  DOC_ORDER,
  GENERATED_DOCS,
  getTemplateKey,
  type DrawCount,
  type UploadedDocName,
} from "./lib/templateKeys";
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
    caseNumber: v.string(),
    drawCount: v.union(v.literal(4), v.literal(5), v.literal(6)),
    lineItems: v.array(lineItemValidator),
    invoiceStorageId: v.id("_storage"),
    waiverIds: v.array(v.id("customDocuments")),
    specSheetIds: v.array(v.id("customDocuments")),
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

    const uploadedDocs = DOC_ORDER.filter(
      (doc): doc is UploadedDocName => !(GENERATED_DOCS as readonly string[]).includes(doc),
    );
    const neededKeys = uploadedDocs.map((doc) => getTemplateKey(doc, drawCount));
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
      caseNumber: args.caseNumber,
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
      // Lien release per-draw fields — blank on all other templates
      lienDrawNumber: "",
      lienDrawAmount: "",
      lienDrawDescription: "",
      isNotFinalDraw: "",
      isFinalDraw: "",
    };

    const scopeSections: ScopeSection[] = await ctx.runAction(
      internal.scopeOfWork.generateScopeSections,
      { lineItems: args.lineItems },
    );

    const docs: { filename: string; doc: PDFDocument; storageId?: Id<"_storage"> }[] = [];
    for (const docName of DOC_ORDER) {
      if ((GENERATED_DOCS as readonly string[]).includes(docName)) {
        docs.push({
          filename: "Scope of Work.pdf",
          doc: await buildScopeOfWorkPdf({
            clientName: args.name,
            clientAddress,
            caseNumber: args.caseNumber,
            sections: scopeSections,
          }),
        });
        continue;
      }

      const key = getTemplateKey(docName as UploadedDocName, drawCount);
      const template = templates.find((t) => t.key === key)!;
      let fieldMap: Record<string, string> | null = template.fieldMap;
      if (!fieldMap) {
        // Mapping hasn't run for this template yet (upload still processing or
        // pre-dates auto-mapping) — generate and persist it now.
        fieldMap = await ctx.runAction(internal.templateMapping.mapTemplateFields, { key });
      }

      // Lien release templates uploaded before the checkbox keys existed won't
      // have isNotFinalDraw / isFinalDraw in their fieldMap. Force a re-map so
      // the checkboxes are picked up.
      if (
        docName === "lien-release" &&
        fieldMap !== null &&
        !Object.values(fieldMap).includes("isNotFinalDraw") &&
        !Object.values(fieldMap).includes("isFinalDraw")
      ) {
        fieldMap = await ctx.runAction(internal.templateMapping.mapTemplateFields, { key });
      }

      const blob = await ctx.storage.get(template.storageId!);
      if (!blob) throw new Error(`Template file missing from storage: ${key}`);
      const bytes = await blob.arrayBuffer();

      // Lien release: one copy per draw, each with per-draw data and the
      // correct "Is Not Final Draw" / "Is Final Draw" checkbox checked.
      if (docName === "lien-release") {
        for (let drawIndex = 1; drawIndex <= drawCount; drawIndex++) {
          const isFinal = drawIndex === drawCount;
          const group = schedule.groups[drawIndex - 1];
          const lienData: PacketData = {
            ...packetData,
            lienDrawNumber: String(drawIndex),
            lienDrawAmount: formatCurrency(schedule.drawAmounts[drawIndex - 1]),
            lienDrawDescription: isFinal
              ? "Release 20% holdback"
              : group
                ? group.map((idx) => args.lineItems[idx].description).join(", ")
                : "",
            isNotFinalDraw: isFinal ? "" : "Yes",
            isFinalDraw: isFinal ? "Yes" : "",
          };
          docs.push({
            filename: `Lien Release (Draw ${drawIndex}).pdf`,
            doc: await fillTemplate(
              bytes,
              buildFieldValues(lienData, fieldMap),
              buildSizeGroups(fieldMap),
            ),
          });
        }
        continue;
      }

      // The addendum's contractor line must show both the personal and company
      // name, e.g. "William Gray / Access Innovations".
      let data = packetData;
      if (docName === "va-addendum") {
        const combined = `${settings.contractorName} / ${settings.contractorCompanyName}`;
        data = { ...packetData, contractorName: combined, contractorCompanyName: combined };
      }

      docs.push({
        filename: TEMPLATE_DISPLAY_NAMES[key],
        doc: await fillTemplate(bytes, buildFieldValues(data, fieldMap), buildSizeGroups(fieldMap)),
      });
    }

    // Custom contract documents are always included, filled with the same
    // packet data, and slot in right after the construction contract (index 0).
    const customContracts = await ctx.runQuery(
      internal.customDocuments.listCustomDocumentsInternal,
      { category: "contract" },
    );
    const customContractDocs: { filename: string; doc: PDFDocument }[] = [];
    for (const custom of customContracts) {
      let fieldMap: Record<string, string> | undefined = custom.fieldMap;
      if (!fieldMap) {
        fieldMap = await ctx.runAction(internal.templateMapping.mapCustomDocumentFields, {
          id: custom._id,
        });
      }
      const blob = await ctx.storage.get(custom.storageId);
      if (!blob) throw new Error(`Document file missing from storage: ${custom.displayName}`);
      customContractDocs.push({
        filename: `${custom.displayName}.pdf`,
        doc: await fillTemplate(
          await blob.arrayBuffer(),
          buildFieldValues(packetData, fieldMap),
          buildSizeGroups(fieldMap),
        ),
      });
    }
    docs.splice(1, 0, ...customContractDocs);

    // The invoice slots in just before the payment schedule, which is last in
    // DOC_ORDER and must always end the packet.
    const invoiceBlob = await ctx.storage.get(args.invoiceStorageId);
    if (!invoiceBlob) throw new Error("Invoice file missing from storage.");
    docs.splice(docs.length - 1, 0, {
      filename: "Invoice.pdf",
      doc: await PDFDocument.load(await invoiceBlob.arrayBuffer()),
      storageId: args.invoiceStorageId,
    });

    // Selected waivers then spec sheets merge verbatim after the invoice,
    // still keeping the payment schedule last. No storageId is set so the
    // clientFiles loop below stores a per-packet copy — deleting a library
    // document later must not break regeneration.
    const selectedDocs: { filename: string; doc: PDFDocument }[] = [];
    for (const id of [...args.waiverIds, ...args.specSheetIds]) {
      const selected = await ctx.runQuery(internal.customDocuments.getCustomDocumentInternal, {
        id,
      });
      if (!selected) throw new Error(`Selected document no longer exists: ${id}`);
      const blob = await ctx.storage.get(selected.storageId);
      if (!blob) throw new Error(`Document file missing from storage: ${selected.displayName}`);
      selectedDocs.push({
        filename: `${selected.displayName}.pdf`,
        doc: await PDFDocument.load(await blob.arrayBuffer()),
      });
    }
    docs.splice(docs.length - 1, 0, ...selectedDocs);

    const mergedBytes = await mergeDocuments(docs.map((d) => d.doc));
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
    // re-merge them later. The invoice blob already lives in storage, so it
    // keeps its existing storageId.
    for (let i = 0; i < docs.length; i++) {
      let storageId = docs[i].storageId;
      if (!storageId) {
        const docBytes = await docs[i].doc.save();
        storageId = await ctx.storage.store(
          new Blob([docBytes as BlobPart], { type: "application/pdf" }),
        );
      }
      await ctx.runMutation(api.clientFiles.addClientFile, {
        clientId,
        storageId,
        filename: docs[i].filename,
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
