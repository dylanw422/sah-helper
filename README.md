# sah-helper

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Convex** - Reactive backend-as-a-service platform
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Floor-plan studio

Open **Floor plans** in the application header, or visit `/floor-plans` after signing in.
Floor finishes start hidden; toggle **Floor finishes** in **Layers** to show them.

The editor fills the viewport without the app header and opens with a furnished example; **New plan** creates a blank drawing or another example. **Home**, to the left of Select, asks for confirmation before returning to the dashboard. Confirming exit flushes the local draft and saves pending changes to a linked client; canceling keeps the editor open.

- Draw connected exterior and interior walls by clicking corners or dragging. Use Rectangle for a four-wall footprint. Enter exact lengths and thicknesses in inches, with grid, endpoint, and wall snapping.
- Closed wall layouts automatically form rooms with usable areas, editable room names and flooring, and clear interior dimensions alongside every wall face. Interior dimension lines stay fixed regardless of furniture or fixture placement, with measurement labels centered on their lines. Interior chains include door and window jambs and omit redundant overall totals. Doorway widths are centered between the jambs in the actual opening, including exterior doors and unclosed partitions. Each shared doorway is labeled once; window measurements stay on their wall dimension lines. Exterior dimensions show both segment chains and overall totals. Unclosed interior partitions retain centerline measurements.
- In **Select**, click a dimension number or its line to edit it directly on the drawing. The value is selected for immediate typing; press Enter to apply, and Escape or click elsewhere to cancel. Unmarked numbers default to feet (`10` means 10 feet). Enter explicit inches (`120"`) or feet/inches (`10' 0"`); decimals and fractions such as `8' 6 1/2"` are supported. Use the arrows beside the input to choose which end moves; the highlighted arrow is the moving end. The opposite boundary and its connected walls move, while room dimensions and roof geometry regenerate. Door/window width labels are read-only on the drawing; select the opening to change its width and position in Properties. Edits that would remove or overlap openings, disconnect walls, or cross rooms are rejected. Dimension changes support undo/redo and save with the plan.
- Closed exterior footprints generate a two-dimensional roof layout with ridges, hips, valleys, and an adjustable eave overhang. New plans default to **Hip**. Choose **Gable** or **Hip** in **Layers → Roof settings**, or click the roof status in the plan summary. Rectangles, angled footprints, and L-, T-, and U-shaped houses follow their exterior geometry. Roof style saves with the plan and appears in SVG and PDF exports; older plans default to gable. Roof layouts are conceptual; structural framing and 3D roof pitch modeling remain outside this MVP.
- Place wall-attached doors and windows, with widths, positions, and independent door hinge-side and swing controls. Select a door and use **Flip hinge side** or **Flip door swing** in Properties. Hinge settings save with the plan and appear in exports. Place 33 scaled furniture, bathroom, kitchen, electrical, and plumbing symbols. Move, resize, rotate, and duplicate objects. Draw electrical, cold-water, hot-water, and drain runs as 2D annotations.
- Choose **Textbox** (T) and click to add a construction note. Type multiline text in Properties, set its width and text size, and show or hide its border. Drag to move a note or use its right handle to resize its width; text wraps and the height adjusts automatically. Copy, delete, and undo/redo work on notes. **Construction notes** in Layers controls drawing/export visibility. Notes save with client plans, copy from Before into After, and are included in JSON, SVG, and PDF exports; Fit to A4 includes notes outside the house.
- In **Select**, drag across empty space (including a room's floor) to select the walls, openings, objects, utility runs, and notes touched by the selection box. Shift-click adds or removes elements; Shift-drag adds to the selection. Drag any selected element to move the group, use arrow keys to nudge, or press Delete / Backspace to remove it. **Delete selected** is also available in Properties. The right panel shows plan details when nothing is selected, and item properties or group actions when a selection exists. Connected wall endpoints and hosted openings follow moved walls. Group moves and deletions each undo as one action. Ctrl/Cmd+A selects all visible elements; Escape clears the selection. Hidden layers are excluded.
- Pan, zoom, show or hide layers, and undo/redo up to 80 edits. Export visible layers as black-and-white SVG or PDF drawings. PDF export defaults to **Fit to A4 page**, automatically choosing portrait or landscape and calculating an exact **1:N** scale that includes dimensions and roof overhang. The scale appears in the export dialog and PDF. Standard **1/4″**, **1/8″**, and **1/16″ = 1′-0″** scales remain in the dropdown and choose a suitable sheet size. Print at **100% / Actual size** with printer scaling disabled to preserve the stated scale.

Each client has a **Before** plan for the existing home and an **After** plan for proposed changes. The client detail page shows both stages: **Draw Before** starts a linked blank drawing; **Create After from Before** becomes available once Before has walls. Starting After copies the latest saved Before, including walls, fixtures, rooms, finishes, and roof settings. The editor saves pending Before changes before copying. Thereafter the two drawings save independently, and the editor's Before/After buttons switch between them. Reopening a stage preserves the existing drawing. Exports identify the selected stage.

**Save plan** links the drawing to an available stage on an existing client or creates a new client with a Before plan (only a name is required). Linked plans autosave in Convex and can be reopened across devices from **My plans** or the client detail page. Existing clients' oldest drawings become Before and After; additional drawings remain available under **Previous plans**, where opening one creates a local copy. Delete After before deleting Before. Saves check revisions to prevent overwriting another person’s changes; reopening the server version keeps conflicting local edits as a separate local copy.

Local drafts and recovery copies autosave in this browser, scoped to the signed-in workspace, with a library of up to 50 drafts. **JSON backup** exports the editable model, and **Import plan backup** restores it as a new draft. Save and storage failures are visible with retry and backup options. The editor follows the application’s dark theme; PDFs and SVG drawings use black-and-white artwork on a white background, with monochrome finish patterns. Multiple stories, roof framing, and simultaneous collaborative editing are outside this MVP.

Run geometry, import validation, and sync fingerprint tests with `bun run test:floor-plans`. Run backend tests with `bun run --cwd packages/backend test` (including client creation, save conflicts, workspace isolation, and deletion).
`tests/floor-plan-browser.mjs` exercises the production editor and save hooks in an isolated Vite harness with a persistent service double, without bypassing application authentication. It requires Playwright and Chromium; after installing Playwright locally, run `node tests/floor-plan-browser.mjs`. You can set `PLAYWRIGHT_MODULE` to an existing Playwright module path and `CHROME_PATH` to a Chrome executable. Screenshots and JSON/SVG/PDF artifacts are written to `/private/tmp/sah-floor-plan-tests` by default (override with `FLOOR_PLAN_TEST_OUTPUT`).

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
bun run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Your app will connect to the Convex cloud backend automatically.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@sah-helper/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Project Structure

```
sah-helper/
├── apps/
│   ├── web/         # Frontend application (Next.js)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── backend/     # Convex backend functions and schema
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:setup`: Setup and configure your Convex project
- `bun run check-types`: Check TypeScript types across all apps
