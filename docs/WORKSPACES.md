# Contractor workspaces

Contractors register at `/sign-up`, then complete company setup before accessing the app. Each account belongs to one workspace. Company details fill the existing invoice and packet forms. Workspace owners can add staff from Settings → Users; staff sign in using the existing first-login code and password setup flow.

## Data boundaries

- Clients, saved invoices, client files, contractor settings, custom contracts, pricing observations, catalog imports, and team membership are workspace scoped on the server.
- Waivers, spec sheets, and job-specific library documents are shared across all workspaces, including existing uploads. Every workspace can view and select them for packets. The uploading workspace retains deletion permissions. Packet generation makes private copies, so existing client packets do not depend on library files remaining available.
- The server derives ownership from the authenticated Better Auth session and membership. Public APIs do not accept a workspace selection or ownership override.
- New owners are bound to their authenticated identity; new staff memberships are bound to the created auth account. Removing membership immediately prevents further data access, even with an existing session.
- Invoice drafts in browser session storage are namespaced by workspace.
- Uploads use a short-lived, single-use workspace ticket at the Convex HTTP endpoint `/workspace-upload`. Uploaded and generated files receive an ownership record before their IDs can be passed to parsing, import, attachment, or registration APIs. The endpoint accepts files up to 20 MB.

## Existing Access Innovations data

The optional `workspaceId` field is deliberate: private records without it remain exclusively in the original Access Innovations workspace. Existing authorized users retain that workspace and their previous administrative access. Public signup cannot claim an email already in the legacy membership table. No destructive backfill or data copy is needed.

The existing `pdfTemplates` records without a workspace ID are the shared base forms. A contractor can upload a private override for a form; this does not change other contractors' forms. Existing custom contracts remain private to Access Innovations. All existing and future waivers, spec sheets, and job-specific library documents are shared automatically by category, with no migration needed.

The existing draw calculations, document sequence, signing fields, and packet generation are unchanged. Custom contracts are included only in their own workspace's packets; shared waivers, spec sheets, and job-specific documents are selected per packet.

## Rollout and verification

Deploy the backend schema, functions, and HTTP route before deploying the frontend. Deploy these changes together; older clients using raw Convex upload URLs must refresh and re-upload any unfinished uploads. Previously saved clients and packet downloads continue to work. Old unscoped browser drafts are intentionally not restored into a workspace.

`SITE_URL` must be the frontend origin (including scheme and port, without a trailing slash), matching the existing Better Auth configuration. `CONVEX_SITE_URL` is supplied by Convex and points to the HTTP actions origin. No new secrets are required.

From the repository root:

```sh
bun install
bun run --cwd packages/backend test
bunx tsc --noEmit -p packages/backend/convex/tsconfig.json
cd apps/web
bunx next typegen
bunx tsc --noEmit
```

The backend tests exercise legacy access, new onboarding, direct-ID read/write denial, independent pricing, file ownership, member permissions, private template overrides, upload ticket reuse, and invoice generation using the real Convex test backend and Better Auth component. `convex-test` is pinned to 0.0.54 for compatibility with the installed Convex version; newer releases require Convex 1.43 or later.

On a staging deployment, verify new account registration and company setup, existing staff sign-in and password setup, uploads from the deployed browser origin, and a full packet using the actual base PDFs and configured AI provider. Deployment and live AI/PDF integration checks are separate from the local automated tests.
