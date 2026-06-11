export type PacketData = {
  // Client
  clientName: string;
  clientStreet: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  clientCityStateZip: string; // "City, ST 12345"
  clientAddress: string; // full combined address
  clientPhone: string;
  invoiceNumber: string;
  caseNumber: string; // VA SAH case number (optional input, may be blank)
  contractTotal: string; // formatted: "$126,000.00"
  drawCount: string; // "4", "5", or "6"

  // Draw amounts (formatted). The last draw (= drawCount) is the 20% holdback
  // and is also exposed as finalDrawAmount for templates with a "Final" field.
  // Unused slots (beyond drawCount) are blank.
  draw1Amount: string;
  draw2Amount: string;
  draw3Amount: string;
  draw4Amount: string;
  draw5Amount: string;
  draw6Amount: string;
  finalDrawAmount: string;

  // Per-draw work descriptions: the line item descriptions assigned to each
  // draw, joined with commas. Draws 1..N-1 only (the holdback has no items).
  draw1Description: string;
  draw2Description: string;
  draw3Description: string;
  draw4Description: string;
  draw5Description: string;

  // Contractor (from settings)
  contractorCompanyName: string;
  contractorName: string;
  contractorAddress: string;
  contractorPhone: string;
  contractorEmail: string;
  contractorLicense: string;

  // Combined name + address blocks (for forms with single name-and-address fields)
  clientNameAddress: string;
  contractorNameAddress: string;

  // Line items (for forms that list them individually)
  lineItem1Description: string;
  lineItem1Amount: string;
  lineItem2Description: string;
  lineItem2Amount: string;
  lineItem3Description: string;
  lineItem3Amount: string;
  lineItem4Description: string;
  lineItem4Amount: string;
  lineItem5Description: string;
  lineItem5Amount: string;
  lineItem6Description: string;
  lineItem6Amount: string;
  lineItem7Description: string;
  lineItem7Amount: string;
  lineItem8Description: string;
  lineItem8Amount: string;
  lineItem9Description: string;
  lineItem9Amount: string;
  lineItem10Description: string;
  lineItem10Amount: string;
};

// Catalog of every PacketData key with a semantic description. This is fed to
// the AI field mapper (convex/templateMapping.ts), which matches a template's
// actual AcroForm field names against these meanings whenever a template is
// uploaded. No manual field-name mapping is required.
export const KEY_DESCRIPTIONS: Record<keyof PacketData, string> = {
  clientName: "The veteran/client's full name (e.g. fields named 'Veteran Name', 'Owner Name', 'Client Name').",
  clientStreet: "The veteran's street address ONLY, without city/state/zip.",
  clientCity: "The veteran's city only.",
  clientState: "The veteran's state only.",
  clientZip: "The veteran's zip code only.",
  clientCityStateZip: "The veteran's city, state, and zip combined in one field (e.g. 'City/State/Zip').",
  clientAddress: "The veteran's full one-line mailing address: street, city, state, zip (e.g. 'Full Address', 'Property Address').",
  clientPhone: "The veteran's phone number.",
  invoiceNumber: "The contractor's invoice number.",
  caseNumber: "The VA SAH case number (e.g. 'Case Number', 'SAH Case', or a bare case/file 'No.' header field).",
  contractTotal: "The total contract amount, formatted as currency (e.g. 'Total Amount', 'Contract Price').",
  drawCount: "The number of draws/payments (4, 5, or 6).",
  draw1Amount: "Dollar amount paid at draw/inspection 1.",
  draw2Amount: "Dollar amount paid at draw/inspection 2.",
  draw3Amount: "Dollar amount paid at draw/inspection 3.",
  draw4Amount: "Dollar amount paid at draw/inspection 4.",
  draw5Amount: "Dollar amount paid at draw/inspection 5.",
  draw6Amount: "Dollar amount paid at draw/inspection 6.",
  finalDrawAmount:
    "Dollar amount of the final draw (the 20% holdback), for fields explicitly named 'final' (e.g. 'Final Inspection Amount', 'VA Final Inspection'). Numbered fields always map to drawNAmount by their number, even when that number is the last draw.",
  draw1Description: "The work items / requirements covered by draw 1 (e.g. '1st Inspection Requirements/Details').",
  draw2Description: "The work items / requirements covered by draw 2.",
  draw3Description: "The work items / requirements covered by draw 3.",
  draw4Description: "The work items / requirements covered by draw 4.",
  draw5Description: "The work items / requirements covered by draw 5.",
  contractorCompanyName: "The contractor's company/business name (e.g. 'Builder Name').",
  contractorName: "The contractor's personal name.",
  contractorAddress: "The contractor's full address.",
  contractorPhone: "The contractor's phone number.",
  contractorEmail: "The contractor's email address.",
  contractorLicense: "The contractor's license number.",
  clientNameAddress: "The veteran's name AND address combined in a single field (e.g. a 'Mortgagor or Sponsor (name and address)' block).",
  contractorNameAddress: "The contractor's name AND address combined in a single field (e.g. a 'Contractor or Builder (name and address)' block).",
  lineItem1Description: "Description of invoice line item 1 (forms listing items individually).",
  lineItem1Amount: "Dollar amount of invoice line item 1.",
  lineItem2Description: "Description of invoice line item 2.",
  lineItem2Amount: "Dollar amount of invoice line item 2.",
  lineItem3Description: "Description of invoice line item 3.",
  lineItem3Amount: "Dollar amount of invoice line item 3.",
  lineItem4Description: "Description of invoice line item 4.",
  lineItem4Amount: "Dollar amount of invoice line item 4.",
  lineItem5Description: "Description of invoice line item 5.",
  lineItem5Amount: "Dollar amount of invoice line item 5.",
  lineItem6Description: "Description of invoice line item 6.",
  lineItem6Amount: "Dollar amount of invoice line item 6.",
  lineItem7Description: "Description of invoice line item 7.",
  lineItem7Amount: "Dollar amount of invoice line item 7.",
  lineItem8Description: "Description of invoice line item 8.",
  lineItem8Amount: "Dollar amount of invoice line item 8.",
  lineItem9Description: "Description of invoice line item 9.",
  lineItem9Amount: "Dollar amount of invoice line item 9.",
  lineItem10Description: "Description of invoice line item 10.",
  lineItem10Amount: "Dollar amount of invoice line item 10.",
};

export const PACKET_DATA_KEYS = Object.keys(KEY_DESCRIPTIONS) as (keyof PacketData)[];

export function isPacketDataKey(key: string): key is keyof PacketData {
  return key in KEY_DESCRIPTIONS;
}

// Families of PacketData keys that render as a visual column on a form, so
// their PDF fields must all use the same (smallest fitting) font size.
const SIZE_GROUP_PATTERNS: RegExp[] = [
  /^draw\dDescription$/,
  /^(draw\dAmount|finalDrawAmount)$/,
  /^lineItem\d+Description$/,
  /^lineItem\d+Amount$/,
];

// Resolve a template's fieldMap into groups of PDF field names that must
// share a font size when filled.
export function buildSizeGroups(fieldMap: Record<string, string>): string[][] {
  return SIZE_GROUP_PATTERNS.map((pattern) =>
    Object.entries(fieldMap)
      .filter(([, key]) => pattern.test(key))
      .map(([fieldName]) => fieldName),
  ).filter((group) => group.length > 1);
}

// Resolve PacketData into a flat fieldName → value map for pdf-lib filling,
// using a template's stored fieldMap (AcroForm field name → PacketData key).
export function buildFieldValues(
  data: PacketData,
  fieldMap: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [fieldName, key] of Object.entries(fieldMap)) {
    if (!isPacketDataKey(key)) continue;
    const value = data[key];
    if (value) values[fieldName] = value;
  }
  return values;
}
