"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";

import { action } from "./_generated/server";
import { requireAuth } from "./lib/auth";

export type ExtractedLineItem = {
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type ExtractedInvoiceData = {
  clientName: string;
  clientStreet: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  clientPhone: string;
  invoiceNumber: string;
  issueDate: string;
  lineItems: ExtractedLineItem[];
  subtotal: number;
  total: number;
  totalMismatchWarning: boolean;
};

const SYSTEM_PROMPT =
  "You are a precise data extraction assistant. Extract the following fields from this invoice PDF and return ONLY valid JSON with no markdown, no explanation, and no extra text.";

const USER_PROMPT = `Extract the following from this invoice:
{
  "clientName": "full name from 'Issued To: Name:' field",
  "clientStreet": "street address from 'Issued To: Address:' field",
  "clientCity": "city parsed from the address",
  "clientState": "state abbreviation parsed from the address",
  "clientZip": "zip code from 'Zip Code:' field",
  "clientPhone": "phone from 'Phone:' field",
  "invoiceNumber": "from 'Invoice #:' field",
  "issueDate": "from 'Issue Date:' field",
  "lineItems": [
    {
      "description": "product description",
      "qty": 1.0,
      "unitPrice": 2500.00,
      "amount": 2500.00
    }
  ],
  "subtotal": 126000.00,
  "total": 126000.00
}

IMPORTANT: List lineItems in logical construction sequence — the order the work would
actually be performed on the job site — NOT the order they appear on the invoice:
demolition/removal/teardown first, then site/structural/framing work, rough plumbing/
electrical/HVAC, insulation and drywall, flooring and tile, cabinetry and fixture
installs, paint/trim/finish work, and cleanup/final items last. For example, "demo
existing flooring" must come before "install new vinyl flooring". Include every line
item exactly once.

Return only the JSON object. No markdown code blocks.`;

function uint8ToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function tryParseInvoiceJson(text: string): Omit<ExtractedInvoiceData, "totalMismatchWarning"> | null {
  // Tolerate accidental markdown fences despite prompt instructions
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.clientName !== "string" ||
      typeof parsed.clientStreet !== "string" ||
      typeof parsed.clientPhone !== "string" ||
      !Array.isArray(parsed.lineItems) ||
      typeof parsed.total !== "number"
    ) {
      return null;
    }
    return {
      clientName: parsed.clientName,
      clientStreet: parsed.clientStreet,
      clientCity: typeof parsed.clientCity === "string" ? parsed.clientCity : "",
      clientState: typeof parsed.clientState === "string" ? parsed.clientState : "",
      clientZip: typeof parsed.clientZip === "string" ? parsed.clientZip : "",
      clientPhone: parsed.clientPhone,
      invoiceNumber: typeof parsed.invoiceNumber === "string" ? parsed.invoiceNumber : "",
      issueDate: typeof parsed.issueDate === "string" ? parsed.issueDate : "",
      lineItems: parsed.lineItems
        .filter(
          (item: unknown): item is Record<string, unknown> =>
            typeof item === "object" && item !== null,
        )
        .map((item: Record<string, unknown>) => ({
          description: typeof item.description === "string" ? item.description : "",
          qty: typeof item.qty === "number" ? item.qty : 1,
          unitPrice: typeof item.unitPrice === "number" ? item.unitPrice : 0,
          amount: typeof item.amount === "number" ? item.amount : 0,
        })),
      subtotal: typeof parsed.subtotal === "number" ? parsed.subtotal : parsed.total,
      total: parsed.total,
    };
  } catch {
    return null;
  }
}

export const parseInvoice = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<ExtractedInvoiceData> => {
    await requireAuth(ctx);

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Invoice file not found in storage.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base64 = uint8ToBase64(bytes);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const callClaude = async () => {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    };

    let parsed = tryParseInvoiceJson(await callClaude());
    if (!parsed) {
      // One retry on malformed output, then surface the error to the user
      parsed = tryParseInvoiceJson(await callClaude());
    }
    if (!parsed) {
      throw new Error("Could not extract data from this invoice. Please try again.");
    }

    const lineItemSum = parsed.lineItems.reduce((sum, item) => sum + item.amount, 0);
    const totalMismatchWarning = Math.abs(lineItemSum - parsed.total) > 0.01;

    return { ...parsed, totalMismatchWarning };
  },
});
