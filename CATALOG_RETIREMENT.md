# Historical catalog retirement

The job-bundle application flow is live in code. Catalog screens, public catalog functions, automatic pricing writes, imports, and AI invoice generation have been removed. The old `catalogItems`, `priceObservations`, and `catalogImports` table definitions remain temporarily so an existing deployment can keep its historical data until a recoverable export is verified. `catalog.backfillFromExisting` is an internal no-op solely to let already-scheduled jobs drain without recreating observations.

Do not delete the old tables or imported PDF blobs as part of a routine deploy. This is a separate, destructive production operation.

## Before retirement

1. Export the production Convex deployment (including storage) and verify that the archive can be read. Record the export timestamp and location outside the deployment.
2. Count records in each retired table per workspace and record the IDs/storage IDs in `catalogImports`. Check the scheduler for old `catalog.backfillFromExisting` jobs; they now no-op, but wait for them to drain before deleting the compatibility endpoint.
3. Confirm that invoice saves, client creation, packet replacement, and the Bundles page produce no new catalog records after the release.
4. For each imported storage ID, check *all* retained references: `clients.packetStorageId`, `clientFiles.storageId`, `pdfTemplates.storageId`, `customDocuments.storageId`, and any other file-owning tables added since this runbook. A `workspaceFiles` row proves ownership, not exclusive catalog use. If any retained reference exists, preserve the blob and its ownership record.

## Bounded deletion

Use a restartable internal migration with a small batch size and a persisted cursor/checkpoint. First remove `priceObservations` that point to retired catalog items, then `catalogItems`. Process `catalogImports` separately. Delete an import blob only after the exclusivity check above; remove its `workspaceFiles` ownership row only if the blob was actually deleted. Do not delete invoices, clients, packets, templates, or library documents.

After each batch, compare remaining counts with the recorded inventory. Stop immediately if a retained reference or unexpected new catalog record appears. Once the three tables are empty and all scheduled jobs have drained, remove the tables and compatibility endpoint from `schema.ts`/`catalog.ts`, regenerate Convex types, and rerun backend tests plus web/backend TypeScript and production-build checks.

Rollback before deleting data can restore the previous app version. After deletion, recovery requires the verified export.
