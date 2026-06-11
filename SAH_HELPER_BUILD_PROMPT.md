# SAH Grant Packet Automation — Build Prompt

## Project Overview

Build a production-ready, multi-user web application for a VA SAH (Specially Adapted Housing) grant contractor to automate the generation of client signature packets. The app is password-gated and allows users to upload an invoice PDF, extract client and job data using AI, verify the extracted data, and automatically fill a set of VA-provided fillable PDF documents — merging them into a single downloadable `Packet.pdf`. All generated packets are stored and tracked with a status system.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) — already configured in monorepo |
| Backend | Convex — already configured |
| Auth | better-auth + @convex-dev/better-auth — already scaffolded |
| UI Components | shadcn/ui |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Animations | Framer Motion |
| Toasts | Sonner |
| Confetti | canvas-confetti |
| AI / PDF Parsing | Claude API (claude-sonnet-4-6) via Anthropic SDK |
| PDF Filling | pdf-lib |
| Package Manager | Bun |

> Do not add or change the tech stack. Work within the existing monorepo at the paths already established.

---

## Monorepo Structure

```
apps/web/          — Next.js frontend (App Router, src/ directory)
packages/backend/  — Convex backend (schema, functions, auth)
packages/ui/       — Shared UI components
packages/env/      — Environment variable validation
```

---

## Authentication

- **Already scaffolded** with better-auth. Sign-in and sign-up forms exist. Do not rebuild auth.
- Username/password only.
- All users have **equal permissions** — no roles.
- Every route except `/sign-in` must be gated behind authentication.
- Redirect unauthenticated users to `/sign-in`.

---

## Application Pages & Routes

### `/dashboard` — Client List (home after login)

The primary view. Shows all clients/packets ever generated.

**Layout:**
- Header with app logo/name ("SAH Helper"), user menu (top right), dark/light mode toggle
- Page title: "Clients" with a "New Packet" button (primary CTA, top right)
- Status filter tabs across the top: **All** | **Unsigned** | **Signed** | **Complete** — with count badges
- Search input to filter by client name
- Client list rendered as cards or a clean table

**Each client row/card shows:**
- Client full name (prominent)
- Client address
- Total contract amount (formatted as currency)
- Draw count (e.g., "5 Draws")
- Created date
- Status badge: **Unsigned** (amber), **Signed** (blue), **Complete** (green)
- Clickable — navigates to `/clients/[id]`

**Empty state:** Friendly illustration + "No clients yet. Upload your first invoice to get started." with a CTA button.

**Animations:**
- Cards/rows stagger-animate in on load using Framer Motion
- Status badge transitions animate on change
- Filter tab switch has a smooth sliding indicator

---

### `/new-packet` — New Packet Wizard

Multi-step wizard. This is the core of the app. State is managed client-side — nothing saved to DB until packet generation is complete.

---

#### Step 1 — Upload & Configure

**UI Elements:**
- Large drag-and-drop zone: "Drop your Invoice PDF here" with a file icon
- Click-to-upload fallback
- Draw count dropdown (required): **4 Draws** / **5 Draws** / **6 Draws**
- File validation: PDF only, max 10MB. Show inline error if wrong type or too large.
- The "Process Invoice" button is disabled until both the file and draw count are selected
- Subtle drag-over glow effect on the drop zone

---

#### Step 2 — AI Extraction (animated processing screen)

Triggered when user clicks "Process Invoice". Full-screen processing view.

**Animated step indicators (sequential, each animates in as it completes):**
1. Uploading invoice...
2. Reading document with AI...
3. Extracting client details...
4. Extracting line items...
5. Preparing verification...

Each step shows a spinner while active, then a green animated checkmark when complete. Use Framer Motion for the checkmark draw animation and staggered step entrance.

**What happens server-side:**
1. Invoice PDF is uploaded to Convex file storage → returns `storageId`
2. A Convex action fetches the file, converts to base64, sends to Claude API
3. Claude extracts structured JSON (see extraction spec below)
4. Result returned to client for Step 3

**On extraction error:** Show a friendly error state with a "Try Again" button.

---

#### Step 3 — Verify Extracted Data

Display all AI-extracted data in an editable form. The user must be able to correct any mistakes before generating the packet.

**Section: Client Information**
- Client Name (text input)
- Street Address (text input)
- City (text input)
- State (text input)
- Zip Code (text input)
- Phone Number (text input)

**Section: Job Summary**
- Total Contract Amount (read-only, derived from line items — updates live as line items change)
- Draw Count (read-only — was selected in Step 1, shown for confirmation)
- Invoice Number (text input)

**Section: Line Items**
- Editable table: Description | Qty | Unit Price | Amount
- Each row is fully editable inline
- "Amount" column auto-calculates from Qty × Unit Price
- Add row button at bottom
- Delete row button (trash icon) on each row
- Running subtotal and total displayed below the table, updating live

**CTA:** "Looks Good — Generate Packet" button at bottom. Secondary: "← Back" to re-upload.

---

#### Step 4 — Generating Packet (animated)

Full-screen animated progress showing each document being filled in sequence.

**Animated steps:**
1. Filling Construction Contract...
2. Filling Payment Schedule...
3. Filling Draw Schedule...
4. Filling VA Addendum...
5. Filling Builder Spec Sheet...
6. Filling Scope of Work...
7. Merging documents...
8. Saving to client record...
9. Packet ready!

Each step animates the same way as Step 2 (spinner → green checkmark). A progress bar at the top fills smoothly as steps complete.

**What happens server-side:**
1. Convex action receives verified client data + draw count
2. Loads the 6 correct PDF templates from storage
3. Enumerates AcroForm fields from each PDF
4. Maps data to field names per the field mapping config
5. Leaves all date fields untouched (blank for pen signing)
6. Merges all 6 filled PDFs into one document using `pdf-lib`
7. Uploads merged PDF to Convex file storage
8. Saves client record to database with `packetStorageId`

---

#### Step 5 — Complete

**UI:**
- Canvas confetti burst on arrival
- Large success icon (animated checkmark)
- "Packet Ready for **[Client Name]**"
- Total contract amount displayed
- Large "Download Packet.pdf" button (primary, with a subtle pulse animation)
- Secondary links: "View Client Record" → `/clients/[id]`, "Process Another Invoice" → restarts wizard

---

### `/clients/[id]` — Client Detail Page

**Layout:**
- Back button → `/dashboard`
- Client name as page heading
- Status selector (dropdown or segmented control): Unsigned / Signed / Complete
- Two-column info card: Client Name, Address, Phone, Invoice #, Draw Count, Contract Total
- Line items table (read-only)
- "Download Packet.pdf" button
- Created date, last updated date
- Danger zone: "Delete Client" button with confirmation dialog ("This will permanently delete this client and their packet. This cannot be undone.")

---

### `/settings` — Contractor Settings

One settings page, accessible from the user menu.

**Contractor Information (used to fill all VA documents):**
- Company Name
- Contractor Full Name
- Address Line 1
- City
- State
- Zip Code
- Phone Number
- Email Address
- License Number

**Save button** — on success, show Sonner toast: "Settings saved."

> These fields are stored as a singleton record in Convex. On first app load, if no settings exist, show a banner prompting the user to configure contractor info before generating packets.

---

## PDF Template System

### Template Storage

Store all blank VA PDF templates in Convex file storage, uploaded once by a developer during setup. Reference each by a well-known key.

**12 template files:**
```
construction-contract-4draw.pdf
construction-contract-5draw.pdf
construction-contract-6draw.pdf
payment-schedule-4draw.pdf
payment-schedule-5draw.pdf
payment-schedule-6draw.pdf
draw-schedule-4draw.pdf
draw-schedule-5draw.pdf
draw-schedule-6draw.pdf
va-addendum.pdf
builder-spec-sheet.pdf
scope-of-work.pdf
```

A Convex table `pdfTemplates` stores `{ key: string, storageId: string }` for each template. Provide a seeding script or admin UI to upload templates.

### Template Selection by Draw Count

```typescript
const DRAW_DEPENDENT_DOCS = [
  "construction-contract",
  "payment-schedule",
  "draw-schedule",
];

function getTemplateKey(docName: string, drawCount: 4 | 5 | 6): string {
  if (DRAW_DEPENDENT_DOCS.includes(docName)) {
    return `${docName}-${drawCount}draw`;
  }
  return docName;
}
```

### PDF Filling with pdf-lib

```typescript
import { PDFDocument } from "pdf-lib";

// Load template, fill fields, return filled PDFDocument
async function fillTemplate(
  templateBytes: ArrayBuffer,
  fieldValues: Record<string, string>
): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  for (const [fieldName, value] of Object.entries(fieldValues)) {
    try {
      const field = form.getTextField(fieldName);
      if (value) field.setText(value);
    } catch {
      // Field not found in this template — skip silently
    }
  }

  // Do NOT flatten — keep fields editable so dates can be pen-filled
  return pdfDoc;
}
```

### PDF Merging

```typescript
async function mergeDocuments(filledDocs: PDFDocument[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const doc of filledDocs) {
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}
```

### Field Mapping Config

Before building, enumerate all AcroForm field names from the provided VA PDFs using:

```typescript
const fields = pdfDoc.getForm().getFields().map(f => f.getName());
console.log(fields);
```

Then create a field mapping config file at `packages/backend/convex/lib/pdfFieldMap.ts`:

```typescript
export type PacketData = {
  // Client
  clientName: string;
  clientStreet: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  clientAddress: string;       // full combined address
  clientPhone: string;
  invoiceNumber: string;
  contractTotal: string;       // formatted: "$126,000.00"
  drawCount: string;           // "4", "5", or "6"

  // Contractor (from settings)
  contractorCompanyName: string;
  contractorName: string;
  contractorAddress: string;
  contractorPhone: string;
  contractorEmail: string;
  contractorLicense: string;

  // Line items (for forms that list them individually)
  lineItem1Description: string;
  lineItem1Amount: string;
  lineItem2Description: string;
  lineItem2Amount: string;
  // ... continue for expected max number of line items
};

// Map PacketData keys → PDF AcroForm field names
// IMPORTANT: These field names must be populated by inspecting the actual VA PDFs
// Run the field enumeration script against each PDF to get exact names
export const FIELD_MAP: Record<keyof PacketData, string> = {
  clientName: "INSERT_ACTUAL_FIELD_NAME",
  clientStreet: "INSERT_ACTUAL_FIELD_NAME",
  // ... fill in after inspecting the PDFs
};
```

> **Critical implementation note:** The field names in `FIELD_MAP` MUST be the exact names of the AcroForm fields in the VA PDFs. These cannot be guessed — enumerate them from the actual documents. The app should include a developer utility route (`/dev/inspect-pdf`) in development mode that loads each template and logs all its field names to help build this map.

---

## Invoice AI Extraction

### Invoice Layout (consistent format for all invoices)

```
TOP-LEFT:  Contractor company name
           Street address, City, State Zip
           Email
           Phone

TOP-RIGHT: Invoice #: INV-XXXX-XXXX
           Issue Date: [date]
           Due Date: [date]

ISSUED TO:
           Name: [client full name]
           Address: [street address + city + state]
           Zip Code: [zip]
           Phone: [phone]

TABLE:     Product | Qty | Unit Price | Amount
           [line items...]

BOTTOM:    Subtotal: $X
           Total: $X
```

### Claude API Extraction

Use the Claude API (`claude-sonnet-4-6`) with vision (send PDF as base64 image or file). Call from a **Convex action** — never expose `ANTHROPIC_API_KEY` to the client.

**System prompt:**
```
You are a precise data extraction assistant. Extract the following fields from this invoice PDF and return ONLY valid JSON with no markdown, no explanation, and no extra text.
```

**User prompt:**
```
Extract the following from this invoice:
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

Return only the JSON object. No markdown code blocks.
```

### Extraction Validation

After receiving Claude's response:
1. Parse JSON — if parse fails, retry once, then return error to user
2. Validate required fields are present: `clientName`, `clientStreet`, `clientPhone`, `lineItems`, `total`
3. Validate `total` matches sum of line item amounts (warn but don't block if off)
4. Return structured data to client for Step 3 verification

---

## Convex Data Model

```typescript
// packages/backend/convex/schema.ts

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  clients: defineTable({
    name: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    phone: v.string(),
    invoiceNumber: v.string(),
    drawCount: v.union(v.literal(4), v.literal(5), v.literal(6)),
    lineItems: v.array(
      v.object({
        description: v.string(),
        qty: v.number(),
        unitPrice: v.number(),
        amount: v.number(),
      })
    ),
    subtotal: v.number(),
    total: v.number(),
    status: v.union(
      v.literal("unsigned"),
      v.literal("signed"),
      v.literal("complete")
    ),
    packetStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  settings: defineTable({
    // Singleton — only one row ever exists
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
    key: v.string(),             // e.g. "construction-contract-4draw"
    storageId: v.id("_storage"),
    uploadedAt: v.number(),
  }).index("by_key", ["key"]),
});
```

---

## Convex Functions

### Queries

```typescript
// clients
listClients()                        // all clients, sorted by createdAt desc
getClient(clientId)                  // single client with all fields
getPacketDownloadUrl(clientId)       // generate short-lived download URL from packetStorageId

// settings
getSettings()                        // returns single settings row or null
```

### Mutations

```typescript
createClient(data: ClientData)       // save client after packet generation
updateClientStatus(clientId, status) // change Unsigned/Signed/Complete
updateSettings(data: SettingsData)   // upsert contractor settings
deleteClient(clientId)               // delete client + storage file
```

### Actions

```typescript
// Parse invoice PDF using Claude API
parseInvoice(storageId: string): Promise<ExtractedInvoiceData>

// Fill all PDF templates and merge into Packet.pdf
generatePacket(
  clientData: VerifiedClientData,
  drawCount: 4 | 5 | 6,
  contractorSettings: ContractorSettings
): Promise<{ storageId: string }>
```

---

## Environment Variables

```bash
# Convex
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=

# Auth (better-auth)
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=

# AI
ANTHROPIC_API_KEY=
```

---

## UI/UX Design Specification

### Design Language

- **Color mode:** Dark by default, toggle available
- **Palette:** Deep navy/charcoal backgrounds (`#0a0f1e`, `#111827`), electric indigo/blue accent (`#6366f1` / `#4f46e5`), white text, muted slate for secondary text
- **Inspiration:** Linear, Vercel dashboard, Raycast — clean, dense, fast
- **Typography:** Large, readable. Client names should feel prominent.
- **Borders:** Subtle — `border-white/10` style
- **Cards:** Slightly elevated with `bg-white/5` or similar glassmorphism-lite effect

### Status Badge Colors
| Status | Color |
|---|---|
| Unsigned | Amber (`bg-amber-500/20 text-amber-400`) |
| Signed | Blue (`bg-blue-500/20 text-blue-400`) |
| Complete | Green (`bg-green-500/20 text-green-400`) |

### Animations (Framer Motion)

- **Page transitions:** Fade + slight upward translate on enter
- **Dashboard list:** Cards stagger in with `staggerChildren: 0.05`
- **Wizard step transitions:** Slide left/right between steps
- **Processing steps:** Each step fades in, spinner → checkmark (SVG path draw animation)
- **Progress bar:** Smooth `width` transition, not jumpy
- **Checkmark:** SVG `pathLength` animation — draws itself in 0.4s
- **Confetti:** Fire `canvas-confetti` on Step 5 arrival
- **Download button:** Subtle `scale` pulse loop when packet is ready
- **Drag-over zone:** `box-shadow` glow pulse when file is held over it
- **Status badge change:** `backgroundColor` transition via Framer Motion `animate`

### Responsive Breakpoints

- Mobile (< 640px): Single column, stacked layout, full-width buttons
- Tablet (640–1024px): Dashboard shifts to compact table view
- Desktop (> 1024px): Full layout with sidebar potential for future

---

## Implementation Notes & Decisions

1. **PDF generation is server-side only.** All pdf-lib logic runs inside Convex actions. Never send raw PDF bytes to the client for processing.

2. **pdf-lib works in Convex's V8 runtime.** It is a pure JavaScript implementation with no Node.js dependencies. Import as `import { PDFDocument } from "pdf-lib"` inside Convex actions.

3. **Template PDFs in Convex storage.** Do not serve templates from `/public` — use Convex file storage so they are not publicly accessible. Upload via a seeding script.

4. **Field names are the single biggest unknown.** The AcroForm field names inside the VA PDFs cannot be guessed. The developer must inspect the actual PDFs using the field enumeration utility and populate `pdfFieldMap.ts` before the filling logic will work correctly.

5. **Wizard state is ephemeral.** Nothing is written to Convex until `generatePacket` completes successfully. If the user closes the browser mid-wizard, they start over. This is intentional — no draft state to manage.

6. **Invoice upload flow:**
   - Client POSTs PDF to a Next.js API route → route uploads to Convex storage → returns `storageId`
   - Alternative: use Convex's `generateUploadUrl` for direct client-to-storage upload (preferred — avoids routing large file through Next.js)

7. **PDF merge order** (always in this sequence):
   1. Construction Contract
   2. Payment Schedule
   3. Draw Schedule
   4. VA Addendum
   5. Builder Spec Sheet
   6. Scope of Work

8. **Date fields are intentionally left blank.** Do not attempt to fill any field whose name contains "date" (case-insensitive). The client will complete these fields by hand with an ink pen.

9. **Settings warning banner.** If `getSettings()` returns null (first-time setup), show a persistent warning banner on the dashboard: "Contractor information is not configured. Packets cannot be generated until settings are complete." with a link to `/settings`.

10. **Packet filename:** Always named `Packet.pdf` on download regardless of client name or date.

---

## Developer Utility (Development Only)

Create a dev-only route `/dev/inspect-templates` (only accessible when `NODE_ENV === "development"`) that:
1. Loads each PDF template from Convex storage
2. Enumerates all AcroForm field names using `pdfDoc.getForm().getFields()`
3. Displays a table: Template Name | Field Name | Field Type
4. Allows the developer to copy the output to populate `pdfFieldMap.ts`

This is essential for the initial field mapping setup and should be built before attempting any PDF filling.
