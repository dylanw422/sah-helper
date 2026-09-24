# Feature Specification: Job Bundles

Status: Application feature implemented. Historical catalog data retirement remains pending a production export and storage-ownership audit (see Section 11). The old catalog tables are retained temporarily; no active catalog UI, public catalog writes, or AI invoice-generation endpoint remains.

## 1. Product decision

Replace the pricing catalog with a workspace-owned library of reusable job bundles. Remove AI invoice generation and the catalog infrastructure that supports it.

A bundle contains a named, ordered set of invoice line items with default quantities and manually maintained prices. It can also include documents from the existing document library. Users apply bundles in the Invoice Builder and then edit the resulting invoice normally.

Bundles must work independently of the old catalog. There will be no catalog item references, learned prices, price observations, or AI-generated pricing in the new feature.

Example: a contractor saves a “Bathroom Modification” bundle containing demolition, shower installation, grab bars, and flooring, along with the shower and grab-bar specification sheets. On the next job, they add that bundle, adjust quantities and prices, and generate the packet.

## 2. Goals and scope

### Included in the initial release

- A Bundles page for creating, viewing, editing, duplicating, and deleting bundles.
- Manual entry of bundle items, default quantities, unit prices, and construction order.
- Selection of existing waivers, specification sheets, and job-specific documents.
- An Add Bundle picker inside the Invoice Builder.
- A review step before bundle items are inserted into an invoice.
- Save as Bundle from the Invoice Builder, including selected invoice rows.
- Persistence of document selections through invoice saving, reopening, packet generation, and invoice revision.
- Workspace access checks on all bundle operations.
- Removal of the catalog interface, catalog writes, catalog-only imports, and AI invoice generation.
- A staged cleanup of obsolete catalog records and catalog-owned storage.

### Outside the initial release

- AI generation or suggestions for bundle content or prices.
- Automatic learning from historical invoices.
- Conditional items, nested bundles, optional item groups, or formulas.
- Applying one multiplier to every bundle quantity.
- A marketplace or sharing bundles across workspaces.
- Automatic repricing of existing invoices when bundle prices change.
- A dedicated bundle version-history interface.
- Importing PDFs directly into a bundle. Existing invoice PDF extraction remains available through the packet workflow.

## 3. Existing behavior and integration points

The repository currently has these relevant pieces:

| Area | Current behavior | Required change |
| --- | --- | --- |
| Catalog page | Lists learned prices, supports editing and PDF imports | Replace with Bundles management |
| Invoice Builder | Manual rows, one final profit row, autosave, packet handoff | Add bundle selection and Save as Bundle |
| AI invoice generation | Backend reads catalog pricing; its UI is disabled | Remove its backend and unused frontend state and handlers |
| Invoice saves and deletes | Update or retract catalog observations | Remove catalog synchronization |
| Client creation and packet replacement | Synchronize client line items into the catalog | Remove catalog synchronization |
| Document library | Contracts are workspace-specific; waivers, spec sheets, and job-specific documents are currently shared | Respect these existing visibility rules when choosing bundle documents |
| Verify step | Selects document IDs before packet generation | Preselect documents inherited from the invoice and allow changes |
| Packet generation | Copies selected library documents into the packet | Reuse this behavior |
| Invoice revision | Carries selected document IDs through a session draft | Extend durable invoice storage so selections survive refresh and reopening |

The current `invoices` schema does not store the selected document IDs. Adding only a bundle picker would therefore lose attachments when a saved invoice is reopened. Durable attachment selections are a required part of this feature.

## 4. Main user workflows

### 4.1 Create a bundle

1. Open Bundles from the Invoice Builder.
2. Select New Bundle.
3. Enter a name and optional internal description.
4. Add line items with descriptions, default quantities, and unit prices.
5. Arrange items in construction order using drag handles or move-up/move-down controls.
6. Select supporting documents from the library.
7. Review the estimated subtotal and save.

The bundle description is for staff and is not printed on invoices or packets.

Save requires a name and at least one valid line item. Documents are optional.

### 4.2 Add a bundle to an invoice

1. Select Add Bundle above the Invoice Builder's line-item editor.
2. Search bundles by name or description.
3. Choose a bundle to see its items, quantities, prices, subtotal, and attachments.
4. Adjust the proposed quantities or prices for this job if needed.
5. Select Add to Invoice.
6. The app inserts the reviewed items before the invoice's profit row and adds the selected documents.

The review shows “Adds N items” and the added subtotal before profit. It also shows the projected invoice total using the invoice's current profit percentage.

Applying a bundle marks the invoice as changed and enters the existing autosave flow. It must not clear client details, the invoice date, invoice number, case number, or existing rows.

### 4.3 Combine multiple bundles

Users can add multiple bundles to an invoice. New items append in the bundle's order before the profit row. Users can reorder all invoice items afterward.

Line items are not automatically merged by description: identical descriptions can represent separate work. Documents are deduplicated by document ID.

If the same bundle is added again during the editing session, show a notice that this adds another copy of its items and require a deliberate Add Again action. Disable the apply button while applying to prevent accidental double insertion.

### 4.4 Save invoice items as a bundle

1. Select Save as Bundle in the Invoice Builder.
2. Choose which regular invoice rows to include; valid regular rows are selected initially.
3. Enter the bundle name and optional description.
4. Choose which selected supporting documents to include.
5. Review and save the bundle.

Save as Bundle never copies client identity, addresses, phone numbers, invoice numbers, case numbers, dates, packet status, or generated PDF files. It excludes the profit row. It creates a reusable template without modifying the invoice.

Users should review descriptions for client-specific wording before saving. Include short helper text: “Remove client-specific details before saving this bundle.”

### 4.5 Edit, duplicate, and delete

- Edit changes defaults used the next time the bundle is added.
- Duplicate creates an independent bundle with its own items and attachment references and opens the editor with a suggested new name.
- Delete requires a confirmation modal: “Delete this bundle? Existing invoices and packets will not be changed.”
- Deleting a bundle removes only its own records. It never deletes library documents, invoices, or packet files.

## 5. Interface requirements

### Bundles page: `/bundles`

Replace the Invoice Builder's Catalog link with Bundles. Provide New Bundle, a search field with the placeholder “Search bundles,” and a list of bundles.

Each entry displays the name, short description if present, regular-item count, document count, subtotal before profit, and last-updated date. Provide Edit, Duplicate, and Delete actions.

Use loading, error, no-bundles, and no-search-results states. The empty state should explain the feature briefly and offer Create Bundle. Search and pagination must cover the entire workspace library, not only the loaded page.

Keep `/catalog` as a redirect to `/bundles` during the transition so old bookmarks remain useful. It must not render or query catalog data.

### Bundle editor

Use a full page or spacious dialog that supports the existing line-item editing pattern. The editor contains:

- Bundle name and optional description.
- Ordered rows with description, quantity, unit price, calculated amount, and remove controls.
- Add Item and row-order controls.
- A document selector grouped by Waivers, Specification Sheets, and Job-Specific Documents.
- A subtotal explicitly labeled “Before profit.”
- Save and Cancel, with protection against losing unsaved edits.

Do not show client fields or a profit row in this editor.

### Add Bundle picker

Show the search/list first, followed by the selected bundle's review. Display missing documents explicitly. On smaller screens, allow the review to scroll while keeping the action buttons reachable.

Dialogs must have visible titles, keyboard access, focus containment, Escape handling, and focus restoration to their triggering button. Provide accessible names for icon-only controls.

## 6. Pricing and calculation rules

1. Bundle prices are entered and maintained manually.
2. Prices and quantities are copied into an invoice when the bundle is applied. Later bundle edits never update that invoice automatically.
3. A bundle has no profit percentage. The invoice's existing profit row applies to the combined regular subtotal exactly once.
4. Applying a bundle preserves the current invoice profit percentage.
5. The current maximum-invoice setting continues to control the invoice's advisory warning. Exceeding it does not block adding the bundle or saving the invoice.
6. Bundle subtotals exclude profit. Picker previews distinguish the added subtotal from the projected invoice total including profit.
7. Validate finite values on the server. Reject negative prices, zero or negative quantities, blank descriptions, and invalid numeric input.
8. Proposed input precision: unit prices support two decimal places; quantities support up to three. Store prices as integer cents in bundle records. Round each calculated row amount to cents before summing.
9. Convert bundle prices to the existing invoice representation at the boundary. Use the same rounding policy when recalculating the invoice, previewing totals, and generating the PDF; do not allow the picker and saved invoice to disagree.
10. Zero-dollar line items are allowed for explicitly included work. Never silently replace a missing price with a learned or estimated price.

## 7. Proposed data model

Use separate child tables rather than growing arrays on bundle records. Derive workspace access from the authenticated membership, including the application's existing legacy-workspace behavior.

### `bundles`

| Field | Purpose |
| --- | --- |
| `workspaceId` | Owning workspace; accommodate legacy records consistently with existing authorization |
| `name` | Display name |
| `normalizedName` | Trimmed, case-insensitive name for duplicate checks |
| `description` | Optional staff-facing description |
| `searchText` | Normalized name and description for indexed search |
| `revision` | Integer incremented on every edit |
| `createdAt`, `updatedAt` | Audit timestamps |

Index by workspace and updated time, and by workspace and normalized name. Add a search index filtered by workspace. Names must be unique within a workspace after normalization; different workspaces may reuse names.

### `bundleItems`

| Field | Purpose |
| --- | --- |
| `workspaceId`, `bundleId` | Ownership and parent reference |
| `description` | Invoice row description |
| `quantity` | Default quantity |
| `unitPriceCents` | Default unit price in integer cents |
| `order` | Stable construction order |

Index by workspace, bundle, and order. Bundle items must not reference `catalogItems`.

### `bundleDocuments`

| Field | Purpose |
| --- | --- |
| `workspaceId`, `bundleId` | Bundle ownership |
| `documentId` | Existing `customDocuments` reference |
| `displayNameSnapshot`, `categorySnapshot` | Explain a missing document if its library record is deleted |
| `order` | Stable order within the bundle editor |

Index by workspace and bundle. Validate that document references are unique within the bundle.

### Invoice attachment persistence

Add optional, bounded `waiverIds`, `specSheetIds`, and `jobSpecificIds` fields to saved invoices. Existing invoices default to empty selections. These fields represent the current invoice's selections, whether added through bundles or manually.

Carry them through `saveInvoice`, `getInvoice`, Invoice Builder hydration, the builder-to-wizard draft, saved-invoice packet creation, verification, and invoice revision. Keep PDF-building arguments separate from attachment metadata so strict action validators do not reject unexpected fields.

No durable link from an invoice row to a bundle is required for the first release. The saved invoice contains an independent copy of descriptions, quantities, and prices.

### Proposed limits

- Bundle name: 1–100 trimmed characters.
- Description: up to 1,000 characters.
- Bundle items: 1–100 rows.
- Item description: 1–500 trimmed characters.
- Bundle attachments: up to 50 unique documents.
- Apply the same numerical and size limits on client and server.
- Validate the combined invoice and projected packet file count against generator and database limits before application. The per-bundle limits alone do not make multiple combined bundles safe.

## 8. Backend operations and permissions

Add `packages/backend/convex/bundles.ts` with validated arguments and return values.

| Operation | Behavior |
| --- | --- |
| `listBundles` | Paginated workspace list with search support |
| `getBundle` | Return metadata, ordered items, and document availability |
| `createBundle` | Validate and write the bundle and child records atomically |
| `updateBundle` | Validate expected revision, replace children, increment revision atomically |
| `duplicateBundle` | Copy content into a new independent bundle in the same workspace |
| `deleteBundle` | Remove the bundle and its bounded children atomically |

Use the existing authenticated workspace access model: workspace members can manage bundles as they currently manage catalog items. Do not introduce new roles for this release.

All ID-based operations verify ownership. Child records must belong to the same workspace and parent. Reject forged cross-workspace IDs even if the caller can guess them.

Document access follows the existing library rules. A shared waiver may be used by another workspace; a private contract cannot. Contracts are excluded from bundle attachment selection because packet generation already includes them through the contractor template workflow.

Use `expectedRevision` on edits to prevent one user from silently overwriting another's changes. A stale edit returns a clear error asking the user to reload the bundle. Adding a bundle uses the exact reviewed snapshot; subsequent library edits do not silently change the rows the user approved.

## 9. Attachment behavior

- Applying a bundle unions its document IDs with the invoice's current selections.
- Two bundles referencing the same document include it once.
- Users can remove a suggested attachment during invoice preparation or verification.
- Selecting a bundle document does not copy its PDF immediately. Packet generation continues to make its own storage copy, as it does today.
- Removing a document from a bundle does not delete the document from the library.
- Deleting a library document does not invalidate already generated packets, which have independent copies.
- A missing document appears by its saved display name in the bundle editor and picker. Users must remove it, replace it, or explicitly choose to continue without it before applying.
- Revalidate document availability at packet generation. If a selected document disappears after application, show an actionable error instead of silently omitting it.
- Preserve the existing packet document ordering and specification-sheet scaling rules. Bundle item order controls invoice work order; bundle attachment order does not override the packet's established document categories.

## 10. Removing the catalog and AI invoice generation

### Frontend cleanup

- Replace `apps/web/src/app/(app)/catalog/page.tsx` with the transition redirect and add the Bundles page.
- Replace Catalog navigation in the Invoice Builder with Bundles.
- Remove unused AI generation state, handlers, voice-input code, response notes, row-replacement confirmation, and imports from the Invoice Builder.
- Remove catalog-specific PDF import dialogs, learned-price displays, and price-lock controls.
- Remove `catalogItemId` and AI estimate metadata where it exists only to support AI invoice generation.
- Update wording and project documentation to describe manually priced bundles.

### Backend cleanup

- Remove `convex/catalog.ts` after all callers and cleanup dependencies are addressed.
- Remove `convex/invoiceGenerator.ts` and its generated API references through normal code generation.
- Remove `syncSource` calls and imports from invoice saves, invoice deletes, client creation, and packet replacement.
- Remove catalog backfill, import, price-observation, and price-statistics logic.
- Replace catalog-specific test assertions with bundle isolation and lifecycle coverage while retaining invoice, client, and workspace authorization tests.
- Remove obsolete table definitions only after their data has been handled in the staged migration below.

### Existing AI workflows remain in scope for the app

Removing AI invoice generation does not remove invoice PDF extraction, PDF template field mapping, or scope-of-work generation. Those are separate active workflows. Audit all imports before removing any SDK dependency or environment variable; the Anthropic SDK and its API key may still be required by these features.

## 11. Data retirement and rollout

Deleting the catalog feature must not delete invoices, client records, generated packets, custom documents, templates, or their file ownership records.

1. Add bundle tables, APIs, screens, and optional invoice attachment fields while old schema tables still exist.
2. Switch the UI to Bundles and stop all new catalog writes. Remove the AI invoice-generation endpoint and catalog-facing public functions once the matching frontend is released.
3. Check for already scheduled catalog backfill work and ensure it cannot recreate observations during cleanup. Retain any required compatibility stubs until those jobs have drained or been handled.
4. Retire records from `catalogItems`, `priceObservations`, and `catalogImports` in bounded, restartable internal migration batches.
5. Before removing an imported PDF, resolve its storage ID and verify that it is exclusively catalog-owned. A registration in `workspaceFiles` establishes ownership, not exclusive usage. Keep any storage blob referenced by a client file, packet, template, document-library item, or other retained record.
6. Remove ownership metadata only for blobs actually deleted. Do not perform broad storage deletion.
7. Verify that retired tables are empty and no live code or scheduled job references them, then remove their schema definitions and cleanup functions.
8. Regenerate the Convex API/types and run the required checks before release.

Do not automatically convert catalog entries into bundles. The old catalog contains individual learned items and does not encode job groupings or construction order. Users can create meaningful bundles manually or use Save as Bundle on existing invoices.

Before destructive data retirement, capture an appropriate export for recovery and document which catalog records and exclusive import files will be removed. The migration must be safe to resume after interruption. Rollback before data retirement can restore the prior application; rollback after retirement requires the captured export.

## 12. Error and edge-case handling

| Situation | Expected behavior |
| --- | --- |
| Duplicate bundle name | Inline validation; suggest a different name |
| Invalid quantity or price | Explain the affected row and block save/application |
| Bundle deleted while picker is open | Report unavailable and keep the invoice unchanged |
| Bundle edited while being reviewed | Apply the reviewed snapshot deliberately, or refresh before applying; never silently mix versions |
| Attachment deleted while editing | Show it as unavailable with replace/remove controls |
| Save or network failure | Keep the user's edits and provide a retry |
| Invoice exceeds configured maximum | Display the existing advisory warning with the revised total |
| Workspace changes | Clear bundle selections and prevent stale workspace drafts from being applied |
| Bundle has a row named Profit | Reject it as a bundle profit row and explain that invoice profit is handled separately |
| Repeated bundle application | Allow only through the deliberate Add Again action; retain separate rows |
| Bundle deleted after invoice save | Invoice data and packet generation continue to work |
| Existing invoice has no attachment fields | Treat them as empty and allow normal editing |

## 13. Implementation sequence

### Phase 1: Persistence and authorization

Implement bundle tables, indexed list/search, detail lookup, CRUD operations, revision checking, and document visibility validation. Add invoice attachment persistence with backward-compatible defaults.

### Phase 2: Bundle management

Build the list, editor, duplicate action, delete confirmation, and empty/error states. Match the existing app's styling and line-item interaction conventions.

### Phase 3: Invoice and packet integration

Add the picker and review, copy rows before profit, preserve attachment selections, and implement Save as Bundle. Connect saved-invoice reopening and Packet Ready → Revise Invoice to the same persistent selections.

### Phase 4: Remove obsolete behavior

Switch navigation, remove disabled AI generation code and endpoints, stop catalog synchronization, replace obsolete tests, and update documentation.

### Phase 5: Data retirement and release verification

Run the staged cleanup, verify retained documents and records, remove retired tables, regenerate types, and complete the checks below.

## 14. Acceptance criteria and verification

The feature is complete when all of the following are true:

- Users can create, edit, duplicate, search, and delete bundles within their workspace.
- A bundle contains ordered manual line items and optional visible library documents without depending on catalog records.
- Applying a bundle retains client information and existing invoice rows, preserves its construction order, and leaves exactly one invoice profit row.
- Bundle defaults and invoice copies are independent in both directions.
- Applying multiple bundles deduplicates documents but does not silently merge work items.
- Save as Bundle excludes profit and all client-specific structured fields.
- Attachment selections survive autosave, refresh, reopening a saved invoice, packet creation, and invoice revision.
- Missing or unauthorized documents cannot silently enter or disappear from a generated packet.
- Bundle deletion cannot delete shared documents or existing invoices and packets.
- The app has no active catalog interface, learned-price writes, AI invoice-generation endpoint, or dead invoice-generation UI handlers.
- Invoice extraction, template mapping, and scope-of-work generation continue working.
- Existing packet replacement still requires the permanent-loss confirmation.
- Existing invoices and clients load without migration-related validation errors.

Automated coverage should focus on workspace isolation, forged IDs, document visibility, stale revisions, independent invoice copies, currency rounding, profit calculation, attachment deduplication, and migration preservation of shared storage.

Manually verify this full workflow: create a bundle with two items and a spec sheet → add it to an invoice → adjust a quantity → save and reload → generate a packet → preview the packet → revise the invoice → regenerate with replacement confirmation. Verify both the invoice amounts and included documents at each stage.

Run web and backend TypeScript checks directly, the relevant backend tests, and a production web build. The repository's root `check-types` task currently covers only packages that declare that script, so it must not be treated as sufficient validation of the web and backend changes.
