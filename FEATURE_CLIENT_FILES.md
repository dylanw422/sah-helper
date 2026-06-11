# Feature: Client File Management & Per-Row Download

## Overview

Upgrade the client dashboard rows so each client exposes a quick download button and an expandable file drawer. The file drawer lists every individual PDF that makes up the packet and accepts drag-and-drop uploads. On the next download, all individual files (generated + uploaded) are merged into a fresh `Packet.pdf`.

---

## UX Design

### Dashboard row (collapsed state)

```
┌─────────────────────────────────────────────────────────────┐
│ ▐ [JD] John Doe            Unsigned   $45,000  4 draws  ↓  │
└─────────────────────────────────────────────────────────────┘
```

- The entire row is **no longer a `<Link>`** — it becomes a `<div>` that toggles the file drawer.
- A **Download button** (icon-only on mobile, labeled on desktop) sits at the right edge. Clicking it downloads `Packet.pdf` directly without opening the drawer. It stops event propagation so the row click does not also toggle.
- A **chevron icon** indicates expand/collapse state (replaces the current `ChevronRightIcon`). Animates 90° when open.
- Navigating to the client detail page still works via a link on the client name text (or a small external-link icon next to the name).

### Dashboard row (expanded state)

```
┌─────────────────────────────────────────────────────────────┐
│ ▐ [JD] John Doe            Unsigned   $45,000  4 draws  ↓  │
│  ─────────────────────────────────────────────────────────  │
│  GENERATED (6)                                              │
│    📄 Construction Contract (4-draw).pdf          ↓         │
│    📄 Payment Schedule (4-draw).pdf               ↓         │
│    📄 Draw Schedule (4-draw).pdf                  ↓         │
│    📄 VA Addendum.pdf                             ↓         │
│    📄 Builder Spec Sheet.pdf                      ↓         │
│    📄 Scope of Work.pdf                           ↓         │
│                                                             │
│  UPLOADED (1)                                               │
│    📄 signed-addendum.pdf                         ↓  🗑     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Drop PDFs here, or click to browse                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- Two sections: **Generated** (read-only, created at packet generation time) and **Uploaded** (user-added, deletable).
- Each file row shows a filename and a download icon. Uploaded files also show a trash icon.
- The drag-and-drop zone accepts `application/pdf` only. Shows a highlighted border on drag-over.
- Uploading a file marks the client as **"packet dirty"** — a subtle indicator (e.g., a small dot on the download button or a tooltip: "Packet will be rebuilt on next download") informs the user that the merged PDF is out of date.

### Client detail page

- The existing **Download Packet.pdf** button gains the same dirty-state indicator.
- A new **"Packet Files"** card (below Line Items, above the bottom action bar) shows the same file list and drag-and-drop zone as the expanded dashboard drawer.

---

## Data Model Changes

### New table: `clientFiles`

```ts
clientFiles: defineTable({
  clientId:    v.id("clients"),
  storageId:   v.id("_storage"),
  filename:    v.string(),
  type:        v.union(v.literal("generated"), v.literal("uploaded")),
  order:       v.number(),   // merge order; generated files use DOC_ORDER index, uploads are appended
  addedAt:     v.number(),
})
  .index("by_clientId", ["clientId"])
  .index("by_clientId_type", ["clientId", "type"]),
```

### Schema change on `clients`

Add one field:

```ts
packetDirty: v.optional(v.boolean()),
```

`packetDirty` is `true` when an uploaded file has been added since the last time the merged `Packet.pdf` was generated. It is cleared to `false` (or deleted) each time `regeneratePacket` completes.

---

## Backend API Changes

### `packets.ts` — `generatePacket` action (update)

After merging and storing the final `Packet.pdf`, also store each individual filled template as a separate `_storage` blob and create a `clientFiles` record for each with `type: "generated"`. Use `DOC_ORDER` index as the `order` value.

```
for (let i = 0; i < neededKeys.length; i++) {
  const individualStorageId = await ctx.storage.store(filledDocBlob);
  await ctx.runMutation(api.clientFiles.addClientFile, {
    clientId, storageId: individualStorageId,
    filename: humanReadableName(neededKeys[i]),  // e.g. "Construction Contract (4-draw).pdf"
    type: "generated",
    order: i,
  });
}
```

### `clientFiles.ts` — new module

| Export | Type | Description |
|--------|------|-------------|
| `listClientFiles` | query | Returns all `clientFiles` for a `clientId`, ordered by `order` asc |
| `addClientFile` | mutation | Inserts a new `clientFiles` record; if `type === "uploaded"`, also sets `clients.packetDirty = true` |
| `deleteClientFile` | mutation | Deletes a `clientFiles` row and its storage blob; only allowed for `type === "uploaded"`; sets `packetDirty = true` if remaining uploads count changed |
| `getFileDownloadUrl` | query | Returns a short-lived download URL for a single `clientFiles.storageId` |

### `packets.ts` — `regeneratePacket` action (new)

Called when the user clicks Download and `packetDirty === true`. Re-fetches all `clientFiles` for the client (ordered by `order`), downloads each blob, merges them in order, stores the new merged PDF, updates `clients.packetStorageId`, and sets `packetDirty = false`.

```ts
export const regeneratePacket = action({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireAuth(ctx);
    // 1. load all clientFiles ordered by `order`
    // 2. download each storageId blob
    // 3. mergeDocuments(blobs)
    // 4. store merged → new packetStorageId
    // 5. runMutation: clients.setPacketStorageId({ clientId, packetStorageId, dirty: false })
    return { packetStorageId };
  },
});
```

### `clients.ts` — additions

- `setPacketStorageId` mutation: updates `packetStorageId` and `packetDirty` atomically.
- `getClient` query: include `packetDirty` in the return shape.

---

## Frontend Component Changes

### `apps/web/src/app/(app)/dashboard/page.tsx`

**`ClientRow`** — refactor:

1. Replace the outer `<Link>` with a `<div>` (keep accessible role/keyboard handling).
2. Add `expanded` local state (or lift to parent if many rows could be open).
3. Add a Download button that calls `handleDownload` (see below). Stop propagation to prevent row toggle.
4. Replace `ChevronRightIcon` with a chevron that rotates when `expanded`.
5. Add an animated `<ClientFileDrawer>` below the row summary, rendered when `expanded`.

**New `ClientFileDrawer` component** (inline or `src/components/client-file-drawer.tsx`):

- Receives `clientId`.
- Calls `useQuery(api.clientFiles.listClientFiles, { clientId })`.
- Calls `useQuery(api.clientFiles.getFileDownloadUrl, ...)` per file (or lazily on click).
- Renders Generated and Uploaded sections.
- Contains `<FileDropZone>` at the bottom.

**`handleDownload` logic** (shared util or hook):

```ts
async function handleDownload(clientId, packetDirty, downloadUrl) {
  if (packetDirty) {
    // call regeneratePacket action, then fetch new URL, then download
  } else {
    // download existing URL directly
  }
}
```

### `apps/web/src/components/client-file-drawer.tsx` (new)

Shared between the dashboard row and the client detail page.

### `apps/web/src/components/file-drop-zone.tsx` (new)

- Accepts `onFiles: (files: File[]) => void`.
- Filters to `application/pdf` only; shows a toast error for non-PDFs.
- Uses `useMutation(api.uploads.generateUploadUrl)` to get a URL, then `fetch(url, { method: 'PUT', body: file })` to upload.
- After upload, calls `useMutation(api.clientFiles.addClientFile)` with the returned `storageId`.
- Shows per-file upload progress (indeterminate spinner is fine).

### `apps/web/src/app/(app)/clients/[id]/page.tsx`

- Add `packetDirty` to the data consumed from `useQuery(api.clients.getClient, ...)`.
- Replace the inline download handler with the shared `handleDownload` util.
- Add `<ClientFileDrawer clientId={clientId} />` in a new `<Card>` below the Line Items card.

---

## Dirty-State Indicator

Show a small amber dot badge on the Download button when `packetDirty === true`, with a tooltip: **"New files added — packet will be rebuilt on download."**

```
[ ↓ Download Packet.pdf ● ]
```

The dot disappears immediately when regeneration completes.

---

## Edge Cases & Constraints

| Case | Behavior |
|------|----------|
| No `packetStorageId` yet | Download button disabled (same as today) |
| Regeneration fails | Toast error; `packetDirty` stays `true`; user can retry |
| User deletes an uploaded file | `packetDirty` set back to `true` so the merged PDF reflects the deletion on next download |
| Deleting the client | `deleteClient` mutation must also delete all `clientFiles` records and their storage blobs |
| Upload of non-PDF | Rejected client-side before any upload URL is requested |
| Multiple concurrent uploads | Each upload gets its own URL; inserts are independent; `packetDirty` set to `true` on each |
| Generated files deleted from `_storage` externally | Out of scope; surface a toast on regeneration failure |

---

## File Naming Convention for Generated Files

Map template keys to human-readable display names in a shared util (`lib/templateNames.ts`):

```
construction-contract-4 → "Construction Contract (4-draw).pdf"
payment-schedule-5       → "Payment Schedule (5-draw).pdf"
draw-schedule-6          → "Draw Schedule (6-draw).pdf"
va-addendum              → "VA Addendum.pdf"
builder-spec-sheet       → "Builder Spec Sheet.pdf"
scope-of-work            → "Scope of Work.pdf"
```

---

## Implementation Order

1. Schema migration — add `clientFiles` table and `packetDirty` field to `clients`.
2. Update `generatePacket` to store individual files and create `clientFiles` records.
3. Implement `clientFiles.ts` backend module.
4. Implement `regeneratePacket` action.
5. Build `FileDropZone` component.
6. Build `ClientFileDrawer` component.
7. Refactor `ClientRow` on the dashboard.
8. Update client detail page.
