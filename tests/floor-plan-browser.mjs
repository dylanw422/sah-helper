import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendRequire = createRequire(resolve(repo, "packages/backend/package.json"));
const webRequire = createRequire(resolve(repo, "apps/web/package.json"));
const { createServer } = await import(pathToFileURL(backendRequire.resolve("vite")).href);
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : "playwright");
const output = process.env.FLOOR_PLAN_TEST_OUTPUT || "/private/tmp/sah-floor-plan-tests";
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve(repo, "tests/floor-plan-harness"),
  resolve: { alias: [
    { find: "next/link", replacement: resolve(repo, "tests/floor-plan-harness/link.tsx") },
    { find: "@", replacement: resolve(repo, "apps/web/src") },
    { find: /^react$/, replacement: webRequire.resolve("react") },
    { find: /^react\/(.*)/, replacement: resolve(repo, "apps/web/node_modules/react/$1") },
    { find: "react-dom/server", replacement: webRequire.resolve("react-dom/server.browser") },
    { find: /^react-dom\/(.*)/, replacement: resolve(repo, "apps/web/node_modules/react-dom/$1") },
  ] },
  server: { host: "127.0.0.1", port: 4179, strictPort: true, fs: { allow: [repo] } },
});
let browser;
const errors = [];
const key = "sah-helper:floor-plan-browser-test";
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1560, height: 1040 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") { errors.push(message.text()); console.error(message.text()); } });
  const find = name => page.getByRole("button", { name, exact: true });
  const history = async redo => { await page.getByRole("application").focus(); await page.keyboard.press(redo ? "ControlOrMeta+Shift+z" : "ControlOrMeta+z"); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  const check = async (condition, description) => { assert(await condition, description); console.log(`PASS ${description}`); };
  const wait = () => page.waitForTimeout(550);
  const interiorLabelsCentered = input => {
    const elements = typeof input === "string" ? [...new DOMParser().parseFromString(input, "image/svg+xml").querySelectorAll("[data-room-dimension]")] : input;
    return elements.every(el => {
      const text = el.querySelector("text");
      if (!text) return true;
      const line = el.querySelector("path").getAttribute("d").match(/[ML][^ML]+/g).slice(-2).map(command => command.slice(1).split(",").map(Number));
      const center = text.parentElement.getAttribute("transform").match(/translate\(([^)]+)\)/)[1].split(" ").map(Number);
      const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1], lengthSquared = dx * dx + dy * dy;
      const along = ((center[0] - line[0][0]) * dx + (center[1] - line[0][1]) * dy) / lengthSquared;
      const aligned = el.dataset.dimensionLabelAdjusted ? along >= 0 && along <= 1 && Math.abs((center[0] - line[0][0]) * dy - (center[1] - line[0][1]) * dx) < 1e-8
        : Math.abs(center[0] - (line[0][0] + line[1][0]) / 2) < 1e-8 && Math.abs(center[1] - (line[0][1] + line[1][1]) / 2) < 1e-8;
      return text.getAttribute("y") === "0" && text.getAttribute("dominant-baseline") === "central" && text.parentElement.getAttribute("text-anchor") === "middle"
        && aligned;
    });
  };
  const interiorArtwork = () => page.locator('[data-room-dimension]').evaluateAll(elements => elements.map(el => {
    const copy = el.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll("*")]) {
      const attributes = [...node.attributes].map(a => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b));
      for (const [name] of attributes) node.removeAttribute(name);
      for (const [name, value] of attributes) node.setAttribute(name, value);
    }
    return copy.outerHTML;
  }));
  const saved = async () => { await wait(); return page.evaluate(k => JSON.parse(localStorage.getItem(k)).plans[0], key); };
  const world = async (x, y) => page.locator('[data-layer="walls"]').evaluate((el, p) => {
    const group = el.closest('svg').querySelector('g[transform^="translate("]');
    const matrix = group.getScreenCTM();
    const pt = new DOMPoint(p.x, p.y).matrixTransform(matrix);
    return { x: pt.x, y: pt.y };
  }, { x, y });
  const click = async (x, y) => { const p = await world(x, y); await page.mouse.click(p.x, p.y); };
  const drag = async (x1, y1, x2, y2) => {
    const a = await world(x1, y1), b = await world(x2, y2);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
  };
  await page.goto("http://127.0.0.1:4179");
  await page.getByRole("application", { name: "Floor plan drawing canvas" }).waitFor();
  await check(page.locator(".fp-studio").evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.top === 0 && Math.abs(box.height - window.innerHeight) < 1 && document.documentElement.scrollHeight <= window.innerHeight;
  }), "floor-plan editor fills the viewport without an app header");
  await check(Promise.resolve(await page.locator(".fp-heading").count() === 0 && await page.locator('.fp-toolbar button[aria-label="Undo"], .fp-toolbar button[aria-label="Redo"]').count() === 0), "editor has one toolbar without the title banner or history buttons");
  await check(page.locator(".fp-toolbar").evaluate(toolbar => {
    const controls = ["Home", "Select", "Pan", "Save plan", "My plans", "New plan", "Export"].map(name => toolbar.querySelector(`button[aria-label="${name}"]`));
    const box = toolbar.getBoundingClientRect();
    return controls.every(control => control && control.getBoundingClientRect().top >= box.top && control.getBoundingClientRect().bottom <= box.bottom);
  }), "plan actions share the drawing toolbar with Select and Pan");
  await check(page.locator(".fp-tools").evaluate(el => el.querySelector('button[aria-label="Home"]').getBoundingClientRect().right < el.querySelector('button[aria-label="Select"]').getBoundingClientRect().left), "Home appears immediately before Select");
  await check(Promise.resolve(await page.locator('[data-layer="walls"] > g').count() === 7), "furnished example opens with seven walls");
  const mergedWallPixels = await page.evaluate(async repo => {
    const { planSvg } = await import(`/@fs/${repo}/apps/web/src/components/floor-plan/export.tsx`);
    const { blankPlan, DEFAULT_LAYERS } = await import(`/@fs/${repo}/apps/web/src/lib/floor-plan/model.ts`);
    const wall = (id, a, b, thickness = 12) => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness, kind: "interior" });
    const cases = [
      { name: "crossing", walls: [wall("a", [0, 60], [120, 60]), wall("b", [60, 0], [60, 120])], probe: [66, 60] },
      { name: "T junction", walls: [wall("a", [0, 60], [120, 60]), wall("b", [60, 60], [60, 120])], probe: [66, 60] },
      { name: "collinear overlap", walls: [wall("a", [0, 60], [100, 60]), wall("b", [60, 60], [120, 60])], probe: [54, 60] },
      { name: "angled overlap", walls: [wall("a", [0, 60], [120, 60]), wall("b", [60, 60], [110, 110])], probe: [66, 58] },
      { name: "different thicknesses", walls: [wall("a", [0, 60], [120, 60], 16), wall("b", [60, 60], [60, 120], 6)], probe: [63, 60] },
    ];
    const layers = Object.fromEntries(Object.keys(DEFAULT_LAYERS).map(key => [key, false]));
    const results = [];
    for (const c of cases) {
      const plan = { ...blankPlan(), walls: c.walls }, boxOnly = planSvg(plan, layers).box;
      const { svg, box } = planSvg(plan, layers, { width: boxOnly.width * 4, height: boxOnly.height * 4 });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      try {
        const img = new Image(); await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
        const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
        const pixel = ctx.getImageData(Math.round((c.probe[0] - box.x) * 4), Math.round((c.probe[1] - box.y) * 4), 1, 1).data;
        results.push({ name: c.name, pixel: [...pixel] });
      } finally { URL.revokeObjectURL(url); }
    }
    return results;
  }, repo);
  for (const result of mergedWallPixels) await check(Promise.resolve(result.pixel.slice(0, 3).every(channel => channel === 221)), `${result.name} renders a continuous wall body without an internal border in print artwork`);

  const mixedWallArtwork = await page.evaluate(async repo => {
    const { planSvg } = await import(`/@fs/${repo}/apps/web/src/components/floor-plan/export.tsx`);
    const { blankPlan, DEFAULT_LAYERS } = await import(`/@fs/${repo}/apps/web/src/lib/floor-plan/model.ts`);
    const wall = (id, a, b, kind = "exterior", thickness = 6) => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, kind, thickness });
    const plan = { ...blankPlan(), walls: [wall("north", [0, 0], [96, 0]), wall("continuation", [96, 0], [240, 0], "interior", 4.5), wall("east", [240, 0], [240, 180]), wall("south", [240, 180], [0, 180]), wall("west", [0, 180], [0, 0])] };
    const { svg } = planSvg(plan, { ...DEFAULT_LAYERS, roof: false });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const face = (id, outline) => {
      const path = doc.querySelector(`[data-wall-${outline ? "outline" : "body"}="${id}"]`);
      const y = Number(path.getAttribute("d").match(/^M[^,]+,([^L]+)/)[1]);
      return y + Number(path.getAttribute("stroke-width")) / 2;
    };
    const inside = [...doc.querySelectorAll("[data-room-dimension]")];
    const top = inside.filter(dim => dim.querySelector("[transform]").getAttribute("transform").startsWith("translate(120 17)"));
    return { bodyFaces: [face("north", false), face("continuation", false)], outlineFaces: [face("north", true), face("continuation", true)], interiorCount: inside.length, topCount: top.length, topLabel: top[0]?.querySelector("text").textContent };
  }, repo);
  await check(Promise.resolve(mixedWallArtwork.bodyFaces.every(y => y === 2.5) && mixedWallArtwork.outlineFaces.every(y => y === 3.5)), "joined interior and exterior wall bodies and borders render perfectly flush on the room side");
  await check(Promise.resolve(mixedWallArtwork.interiorCount === 2 && mixedWallArtwork.topCount === 1 && mixedWallArtwork.topLabel === "19′ 6″"), "exported mixed wall run has one continuous interior dimension and no opposite duplicates");

  const oppositeDimensions = await page.evaluate(async repo => {
    const { planSvg } = await import(`/@fs/${repo}/apps/web/src/components/floor-plan/export.tsx`);
    const { automaticDimensions } = await import(`/@fs/${repo}/apps/web/src/lib/floor-plan/dimensions.ts`);
    const { blankPlan, DEFAULT_LAYERS } = await import(`/@fs/${repo}/apps/web/src/lib/floor-plan/model.ts`);
    const wall = (id, a, b, kind = "exterior") => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, kind, thickness: 6 });
    const walls = [wall("north", [0, 0], [240, 0], "interior"), wall("east", [240, 0], [240, 180], "interior"), wall("south", [240, 180], [0, 180]), wall("west", [0, 180], [0, 0])];
    const marks = plan => {
      const dimensions = automaticDimensions(plan), { svg } = planSvg(plan, { ...DEFAULT_LAYERS, roof: false });
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return [...doc.querySelectorAll("[data-room-dimension]")].map(node => ({ dimension: dimensions.find(dim => dim.id === node.getAttribute("data-dimension")), label: node.querySelector("text")?.textContent }));
    };
    return {
      rectangle: marks({ ...blankPlan(), walls }),
      split: marks({ ...blankPlan(), walls: [...walls, wall("branch", [120, 180], [120, 120], "interior")] }),
    };
  }, repo);
  await check(Promise.resolve(oppositeDimensions.rectangle.length === 2 && oppositeDimensions.rectangle.every(mark => mark.dimension.exteriorFace && mark.label)), "opposite room measurements render once and prefer the exterior wall faces");
  await check(Promise.resolve(oppositeDimensions.split.map(mark => mark.dimension.value).sort((a, b) => a - b).join(",") === "114,114,174,234" && oppositeDimensions.split.every(mark => mark.label)), "partitioned opposite walls retain both split dimensions and the different full-room measurement in exports");

  await check(Promise.resolve(await page.locator('[data-layer="rooms"] polygon').count() === 4), "four rooms generated automatically");
  await check(Promise.resolve(await page.getByRole("textbox", { name: "Plan name", exact: true }).count() === 1 && await page.locator(".fp-empty-properties, .fp-properties").count() === 0), "unselected right panel shows plan details without an empty properties section");
  const bulkContext = await browser.newContext({ viewport: { width: 1560, height: 1040 } });
  const bulkPlan = { ...(await saved()), id: "bulk-selection-browser", name: "Group selection test", rooms: {}, walls: [
    { id: "north", a: { x: 0, y: 0 }, b: { x: 360, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "east", a: { x: 360, y: 0 }, b: { x: 360, y: 240 }, kind: "exterior", thickness: 6 },
    { id: "south", a: { x: 360, y: 240 }, b: { x: 0, y: 240 }, kind: "exterior", thickness: 6 },
    { id: "west", a: { x: 0, y: 240 }, b: { x: 0, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "partition", a: { x: 180, y: 0 }, b: { x: 180, y: 240 }, kind: "interior", thickness: 4.5 },
  ], openings: [{ id: "door", wallId: "south", kind: "door", width: 36, t: .75, flip: false }], fixtures: [
    { id: "bed", catalogId: "queen-bed", x: 240, y: 84, width: 60, depth: 80, rotation: 0 },
    { id: "toilet", catalogId: "toilet", x: 300, y: 156, width: 20, depth: 28, rotation: 0 },
  ], notes: [{ id: "note", x: 228, y: 174, width: 72, fontSize: 8, text: "Note", border: true }], utilities: [{ id: "run", kind: "cold", a: { x: 210, y: 54 }, b: { x: 294, y: 54 } }] };
  const architectureContext = await browser.newContext({ viewport: { width: 1560, height: 1040 } });
  const architecturePlan = { ...bulkPlan, id: "architecture-tools", name: "Architecture tools", fixtures: [], openings: [], notes: [], utilities: [] };
  await architectureContext.addInitScript(({ key, plan }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: plan.id, plans: [plan] })); }, { key, plan: architecturePlan });
  const architecturePage = await architectureContext.newPage();
  architecturePage.on("pageerror", error => errors.push(error.message));
  await architecturePage.goto("http://127.0.0.1:4179"); await architecturePage.getByRole("application").waitFor();
  const architectureButton = name => architecturePage.getByRole("button", { name, exact: true });
  const architectureSaved = async () => { await architecturePage.waitForTimeout(550); return architecturePage.evaluate(k => JSON.parse(localStorage.getItem(k)).plans[0], key); };
  const architectureWorld = (x, y) => architecturePage.locator('[data-layer="walls"]').evaluate((el, p) => { const matrix = el.closest("svg").querySelector('g[transform^="translate("]').getScreenCTM(); return new DOMPoint(p.x, p.y).matrixTransform(matrix).toJSON(); }, { x, y });
  const architectureClick = async (x, y) => { const p = await architectureWorld(x, y); await architecturePage.mouse.click(p.x, p.y); };
  const architectureNumber = async (name, value) => { const input = architecturePage.getByRole("spinbutton", { name, exact: true }); await input.fill(String(value)); await input.press("Enter"); };
  await check(Promise.resolve(await architecturePage.locator('.fp-tool-list button').filter({ hasText: "Stairs" }).count() === 1 && await architecturePage.locator('.fp-tool-list button').filter({ hasText: "Opening" }).count() === 1), "Architecture offers Stairs and plain Opening tools");
  await architectureButton("Stairs").click(); await architectureClick(90, 120);
  await check(Promise.resolve(await architecturePage.locator('[data-kind="fixture"] [data-stair-step]').count() === 12 && (await architectureSaved()).fixtures[0].steps === 12), "stairs place with twelve visible steps and an editable saved step count");
  await architectureNumber("Number of steps", 18); await architectureNumber("Width", 48); await architectureNumber("Depth", 144);
  await check(Promise.resolve(await architecturePage.locator('[data-kind="fixture"] [data-stair-step]').count() === 18 && (await architectureSaved()).fixtures[0].steps === 18), "changing the stairs step count redraws eighteen treads and preserves their editable footprint");
  await architectureNumber("Number of steps", 2.5);
  await check(Promise.resolve((await architectureSaved()).fixtures[0].steps === 18 && await architecturePage.getByRole("spinbutton", { name: "Number of steps", exact: true }).inputValue() === "18"), "fractional stair counts are rejected without altering the saved stairs");
  await architectureButton("Select").click(); await architectureButton("Rotate").click(); await architectureButton("Copy").click();
  await check(Promise.resolve((await architectureSaved()).fixtures.every(f => f.steps === 18 && f.rotation === 90)), "stairs rotate and copy while retaining their number of steps");
  await architecturePage.getByRole("application").focus(); await architecturePage.keyboard.press("ControlOrMeta+z");
  await check(Promise.resolve((await architectureSaved()).fixtures.length === 1), "copied stairs undo as one change");
  await architectureButton("Opening").click(); await architectureClick(180, 120); await architectureNumber("Opening width", 60);
  let architecture = await architectureSaved();
  await check(Promise.resolve(architecture.openings[0].kind === "opening" && architecture.openings[0].width === 60 && await architecturePage.locator('[data-kind="opening"] path, [data-kind="opening"] [data-door-hinge]').count() === 0 && await architectureButton("Flip hinge side").count() === 0), "plain wall openings have an adjustable width and no window artwork or door swing controls");
  const startGap = await architectureWorld(180, 120), endGap = await architectureWorld(180, 150);
  await architectureButton("Select").click(); await architecturePage.mouse.move(startGap.x, startGap.y); await architecturePage.mouse.down(); await architecturePage.mouse.move(endGap.x, endGap.y, { steps: 10 }); await architecturePage.mouse.up();
  architecture = await architectureSaved();
  await check(Promise.resolve(architecture.openings[0].t === .625 && architecture.openings[0].width === 60), "plain openings drag along their host wall without changing width");
  const exportedArchitecture = await architecturePage.evaluate(async ({ repo, plan }) => {
    const { planSvg } = await import(`/@fs/${repo}/apps/web/src/components/floor-plan/export.tsx`);
    const { DEFAULT_LAYERS } = await import(`/@fs/${repo}/apps/web/src/lib/floor-plan/model.ts`);
    const doc = new DOMParser().parseFromString(planSvg(plan, { ...DEFAULT_LAYERS, roof: false }).svg, "image/svg+xml");
    return { steps: doc.querySelectorAll('[data-stair-step]').length, gapMarks: doc.querySelectorAll('[data-kind="opening"] path').length, segments: [...doc.querySelectorAll('[data-wall-body="partition"]')].map(p => p.getAttribute("d")) };
  }, { repo, plan: architecture });
  await check(Promise.resolve(exportedArchitecture.steps === 18 && exportedArchitecture.gapMarks === 0 && isDeepStrictEqual(exportedArchitecture.segments, ["M180,0L180,120", "M180,180L180,240"])), "SVG export preserves stair treads and a plain sixty-inch wall break");
  await architecturePage.reload(); await architecturePage.getByRole("application").waitFor();
  await check(Promise.resolve((await architectureSaved()).fixtures[0].steps === 18 && (await architectureSaved()).openings[0].width === 60 && await architecturePage.locator('[data-stair-step]').count() === 18), "stairs and plain opening properties survive autosave and reload");
  await architectureClick(180, 150); await architectureButton("Delete").click();
  await check(Promise.resolve((await architectureSaved()).openings.length === 0 && await architecturePage.locator('[data-wall-body="partition"]').count() === 1), "deleting a plain opening closes its wall break");
  await architectureContext.close();
  const hallwayContext = await browser.newContext({ viewport: { width: 1560, height: 1040 } });
  const hallwayPlan = { ...architecturePlan, id: "hallway-opening", name: "Hallway opening", walls: [
    { id: "north", a: { x: 0, y: 0 }, b: { x: 24, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "east", a: { x: 24, y: 0 }, b: { x: 24, y: 120 }, kind: "exterior", thickness: 6 },
    { id: "south", a: { x: 24, y: 120 }, b: { x: 0, y: 120 }, kind: "exterior", thickness: 6 },
    { id: "west", a: { x: 0, y: 120 }, b: { x: 0, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "hallway", a: { x: 0, y: 60 }, b: { x: 24, y: 60 }, kind: "interior", thickness: 4.5 },
  ] };
  await hallwayContext.addInitScript(({ key, plan }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: plan.id, plans: [plan] })); }, { key, plan: hallwayPlan });
  const hallwayPage = await hallwayContext.newPage();
  hallwayPage.on("pageerror", error => errors.push(error.message));
  await hallwayPage.goto("http://127.0.0.1:4179"); await hallwayPage.getByRole("application").waitFor();
  await hallwayPage.getByRole("button", { name: "Opening", exact: true }).click();
  const hallwayPoint = await hallwayPage.locator('[data-layer="walls"]').evaluate(el => new DOMPoint(12, 60).matrixTransform(el.closest("svg").querySelector('g[transform^="translate("]').getScreenCTM()).toJSON());
  await hallwayPage.mouse.click(hallwayPoint.x, hallwayPoint.y);
  const hallwaySaved = async () => { await hallwayPage.waitForTimeout(550); return hallwayPage.evaluate(k => JSON.parse(localStorage.getItem(k)).plans[0], key); };
  await check(Promise.resolve((await hallwaySaved()).openings[0]?.width === 24 && await hallwayPage.locator('[data-wall-body="hallway"]').count() === 0 && await hallwayPage.locator('[data-wall-body="east"], [data-wall-body="west"]').count() === 2), "a plain opening fits a short hallway wall and removes its entire length without removing the adjoining walls");
  const hallwayWidth = hallwayPage.getByRole("spinbutton", { name: "Opening width", exact: true });
  await hallwayWidth.fill("18"); await hallwayWidth.press("Enter");
  await check(Promise.resolve((await hallwaySaved()).openings[0].width === 18 && await hallwayPage.locator('[data-wall-body="hallway"]').count() === 2), "hallway openings resize with less than four inches of wall remaining at each end");
  await hallwayWidth.fill("24"); await hallwayWidth.press("Enter");
  await hallwayPage.reload(); await hallwayPage.getByRole("application").waitFor();
  await check(Promise.resolve((await hallwaySaved()).openings[0].width === 24 && await hallwayPage.locator('[data-wall-body="hallway"]').count() === 0), "a full-width hallway opening survives autosave and reload");
  await hallwayContext.close();
  const compactContext = await browser.newContext({ viewport: { width: 1560, height: 1040 } });
  const compactPlan = { ...architecturePlan, id: "compact-dimensions", name: "Compact room dimensions", walls: [
    { id: "north", a: { x: 0, y: 0 }, b: { x: 54, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "east", a: { x: 54, y: 0 }, b: { x: 54, y: 42 }, kind: "exterior", thickness: 6 },
    { id: "south", a: { x: 54, y: 42 }, b: { x: 0, y: 42 }, kind: "exterior", thickness: 6 },
    { id: "west", a: { x: 0, y: 42 }, b: { x: 0, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "short", a: { x: 12, y: 12 }, b: { x: 17, y: 12 }, kind: "interior", thickness: 4.5 },
  ] };
  await compactContext.addInitScript(({ key, plan }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: plan.id, plans: [plan] })); }, { key, plan: compactPlan });
  const compactPage = await compactContext.newPage();
  compactPage.on("pageerror", error => errors.push(error.message));
  await compactPage.goto("http://127.0.0.1:4179"); await compactPage.getByRole("application").waitFor();
  const labelsReadable = () => {
    const boxes = [...document.querySelectorAll('[data-layer="dimensions"] text, [data-room-label]')].map(el => el.getBoundingClientRect());
    return boxes.every((a, i) => boxes.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
  };
  for (let i = 0; i < 8; i++) await compactPage.getByRole("button", { name: "Zoom out", exact: true }).click();
  const dimensionScreenSize = el => Number(el.getAttribute("font-size")) * Math.hypot(el.getScreenCTM().a, el.getScreenCTM().b);
  const compactNorthText = compactPage.locator('[data-dimension="exterior:side:north:segment:0"] text');
  const compactFontBeforeZoom = await compactNorthText.evaluate(dimensionScreenSize);
  await check(compactPage.locator('[data-room-dimension] text').evaluateAll(elements => {
    const angles = elements.map(el => Number(el.parentElement.getAttribute("transform").match(/rotate\(([^)]+)\)/)[1]));
    return elements[0]?.closest('svg').querySelectorAll('[data-room-dimension]').length === 2 && angles.length === 2 && angles.some(angle => Math.abs(Math.sin((angle - angles[0]) * Math.PI / 180)) > .9);
  }), "small rooms keep both a width and a depth dimension visible when zoomed out");
  await check(Promise.resolve(await compactPage.locator('[data-dimension^="wall:short:"]').count() === 0 && await compactPage.evaluate(labelsReadable, undefined)), "small-room measurements omit spans under six inches and keep visible dimension and room labels from overlapping");
  await check(compactPage.locator('[data-layer="dimensions"] text').evaluateAll(elements => elements.length > 0 && elements.every(el => Number(el.getAttribute("font-size")) * Math.hypot(el.getScreenCTM().a, el.getScreenCTM().b) >= (el.closest('[data-dimension-label-adjusted]') ? 7.9 : 10.9) - 4 / 3)), "dimensions keep their screen size with the one-point font reduction");
  const compactFirst = compactPage.locator('[data-room-dimension] [data-edit-dimension]').first();
  await compactFirst.focus(); await compactFirst.press("Enter");
  await check(compactPage.locator(".fp-dimension-editor").evaluate(el => {
    const label = document.querySelector('[data-room-dimension] [data-edit-dimension] text').getBoundingClientRect(), editor = el.getBoundingClientRect();
    return Math.abs(editor.x + editor.width / 2 - label.x - label.width / 2) < 3 && Math.abs(editor.y + 17 - label.y - label.height / 2) < 3;
  }), "the inline editor anchors to the compact label when its position moves along a dimension side");
  await compactPage.getByRole("textbox", { name: "New dimension", exact: true }).press("Escape");
  await compactPage.screenshot({ path: resolve(output, "compact-room-dimensions.png"), fullPage: true });
  for (let i = 0; i < 16; i++) await compactPage.getByRole("button", { name: "Zoom in", exact: true }).click();
  await check(Promise.resolve(await compactPage.locator('[data-room-dimension]').count() === 2 && await compactPage.locator('[data-room-dimension] text').count() === 2 && await compactPage.evaluate(labelsReadable, undefined)), "zooming in keeps exactly two small-room dimensions readable without opposite duplicates");
  await check(Promise.resolve(await compactNorthText.evaluate(dimensionScreenSize) > compactFontBeforeZoom * 3 && await compactNorthText.evaluate(el => Number(el.getAttribute("font-size")) >= 11 - 4 / 3)), "zooming in enlarges dimension text while retaining a minimum drawing font size");
  await compactPage.screenshot({ path: resolve(output, "zoomed-room-dimensions.png"), fullPage: true });
  const compactEditable = compactPage.locator('[data-room-dimension] [data-edit-dimension]').first();
  await compactEditable.focus(); await compactEditable.press("Enter");
  await check(Promise.resolve(await compactPage.getByRole("textbox", { name: "New dimension", exact: true }).count() === 1), "small-room dimensions revealed by zooming remain editable");
  await compactPage.getByRole("textbox", { name: "New dimension", exact: true }).press("Escape");
  const compactExport = await compactPage.evaluate(async ({ repo, plan }) => {
    const { planSvg } = await import(`/@fs/${repo}/apps/web/src/components/floor-plan/export.tsx`);
    const { DEFAULT_LAYERS } = await import(`/@fs/${repo}/apps/web/src/lib/floor-plan/model.ts`);
    const root = new DOMParser().parseFromString(planSvg(plan, { ...DEFAULT_LAYERS, roof: false }).svg, "image/svg+xml").documentElement;
    root.style.cssText = "position:absolute;left:0;top:0;opacity:0;pointer-events:none";
    document.body.append(root);
    const boxes = [...root.querySelectorAll('[data-layer="dimensions"] text, [data-room-label]')].map(el => el.getBoundingClientRect());
    const angles = [...root.querySelectorAll('[data-room-dimension] text')].map(el => Number(el.parentElement.getAttribute("transform").match(/rotate\(([^)]+)\)/)[1]));
    const result = { short: root.querySelectorAll('[data-dimension^="wall:short:"]').length, readable: boxes.every((a, i) => boxes.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)), twoSides: angles.length >= 2 && angles.some(angle => Math.abs(Math.sin((angle - angles[0]) * Math.PI / 180)) > .9) };
    root.remove(); return result;
  }, { repo, plan: compactPlan });
  await check(Promise.resolve(compactExport.short === 0 && compactExport.readable && compactExport.twoSides), "small-room exports keep width and depth dimensions readable and omit sub-six-inch spans");
  const narrowPlan = { ...compactPlan, name: "Narrow room dimensions", walls: compactPlan.walls.map(w => ({ ...w, a: { ...w.a, x: w.a.x * 2 / 3 }, b: { ...w.b, x: w.b.x * 2 / 3 } })) };
  const narrowContext = await browser.newContext({ viewport: { width: 1560, height: 1040 } });
  await narrowContext.addInitScript(({ key, plan }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: plan.id, plans: [plan] })); }, { key, plan: narrowPlan });
  const narrowPage = await narrowContext.newPage();
  narrowPage.on("pageerror", error => errors.push(error.message));
  await narrowPage.goto("http://127.0.0.1:4179"); await narrowPage.getByRole("application").waitFor();
  for (let i = 0; i < 8; i++) await narrowPage.getByRole("button", { name: "Zoom out", exact: true }).click();
  await narrowPage.screenshot({ path: resolve(output, "narrow-room-dimensions.png"), fullPage: true });
  const narrowLabels = await narrowPage.locator('[data-room-dimension] text').allTextContents();
  await check(Promise.resolve(narrowLabels.length === 2 && narrowLabels.includes("30″") && narrowLabels.includes("3′") && await narrowPage.evaluate(labelsReadable)), `a narrower closet-sized room keeps thirty-inch width and three-foot depth labels without overlap: ${narrowLabels.join(", ")}`);
  await narrowContext.close();
  await compactContext.close();
  await bulkContext.addInitScript(({ key, plan }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: plan.id, plans: [plan] })); }, { key, plan: bulkPlan });
  const bulkPage = await bulkContext.newPage();
  bulkPage.on("pageerror", error => errors.push(error.message));
  await bulkPage.goto("http://127.0.0.1:4179"); await bulkPage.getByRole("application").waitFor();
  await bulkPage.getByRole("button", { name: "Fit plan to view", exact: true }).click();
  const bulkButton = name => bulkPage.getByRole("button", { name, exact: true });
  const bulkSaved = async () => { await bulkPage.waitForTimeout(550); return bulkPage.evaluate(k => JSON.parse(localStorage.getItem(k)).plans[0], key); };
  const bulkWorld = (x, y) => bulkPage.locator('[data-layer="walls"]').evaluate((el, p) => { const matrix = el.closest("svg").querySelector('g[transform^="translate("]').getScreenCTM(), point = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: point.x, y: point.y }; }, { x, y });
  const bulkClick = async (x, y) => { const p = await bulkWorld(x, y); await bulkPage.mouse.click(p.x, p.y); };
  const bulkDrag = async (ax, ay, bx, by) => { const a = await bulkWorld(ax, ay), b = await bulkWorld(bx, by); await bulkPage.mouse.move(a.x, a.y); await bulkPage.mouse.down(); await bulkPage.mouse.move(b.x, b.y, { steps: 12 }); await bulkPage.mouse.up(); };
  const bulkHistory = async redo => { await bulkPage.getByRole("application").focus(); await bulkPage.keyboard.press(redo ? "ControlOrMeta+Shift+z" : "ControlOrMeta+z"); await bulkPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  const bulkCount = async () => Number((await bulkPage.getByRole("status", { name: "Selected element count" }).textContent()).split(" ")[0]);
  await bulkClick(240, 84);
  await check(Promise.resolve(await bulkPage.getByRole("spinbutton", { name: "Width", exact: true }).count() === 1 && await bulkPage.getByRole("textbox", { name: "Plan name", exact: true }).count() === 0 && await bulkPage.locator(".fp-plan-summary").count() === 0), "selecting an item replaces all plan details with its properties");
  await bulkButton("Clear selection").click();
  await check(Promise.resolve(await bulkPage.getByRole("textbox", { name: "Plan name", exact: true }).count() === 1 && await bulkPage.locator(".fp-properties").count() === 0), "clearing selection restores the complete plan details panel");
  const boxStart = await bulkWorld(204, 30), boxEnd = await bulkWorld(330, 213);
  await bulkPage.mouse.move(boxStart.x, boxStart.y); await bulkPage.mouse.down(); await bulkPage.mouse.move(boxEnd.x, boxEnd.y, { steps: 12 });
  await check(Promise.resolve(await bulkPage.locator('[data-selection-marquee]').count() === 1), "dragging the room floor displays a live selection box");
  await bulkPage.screenshot({ path: resolve(output, "group-selection-marquee.png"), fullPage: true });
  await bulkPage.mouse.up();
  await check(Promise.resolve(await bulkCount() === 4 && await bulkPage.locator('[data-group-selection]').count() === 1 && await bulkPage.locator(".fp-plan-summary").count() === 0), "marquee selects furniture, a note and a utility run with group actions instead of plan details");
  await bulkDrag(240, 84, 264, 108);
  let group = await bulkSaved();
  await check(Promise.resolve(group.fixtures[0].x === 264 && group.fixtures[1].x === 324 && group.notes[0].x === 252 && group.utilities[0].a.x === 234 && isDeepStrictEqual(group.walls, bulkPlan.walls)), "dragging a selected item moves every selected object, note and utility together");
  await bulkHistory(false);
  await check(Promise.resolve(isDeepStrictEqual((await bulkSaved()).fixtures, bulkPlan.fixtures) && isDeepStrictEqual((await bulkSaved()).notes, bulkPlan.notes)), "one undo restores the entire group move");
  await bulkHistory(true); await bulkHistory(false);
  await bulkPage.keyboard.press("ArrowRight");
  await check(Promise.resolve((await bulkSaved()).fixtures[0].x === 246 && (await bulkSaved()).notes[0].x === 234), "arrow keys nudge the complete selection by one grid step");
  await bulkHistory(false);
  await bulkPage.keyboard.down("Shift"); await bulkClick(240, 84); await bulkPage.keyboard.up("Shift");
  await check(Promise.resolve(await bulkCount() === 3), "Shift-click removes an item from the group");
  await bulkPage.keyboard.down("Shift"); await bulkClick(240, 84); await bulkPage.keyboard.up("Shift");
  await check(Promise.resolve(await bulkCount() === 4), "Shift-click adds an item without replacing the rest of the group");
  await bulkPage.keyboard.press("Delete"); group = await bulkSaved();
  await check(Promise.resolve(group.fixtures.length === 0 && group.notes.length === 0 && group.utilities.length === 0 && group.walls.length === 5 && group.openings.length === 1), "Delete removes only the selected group in one operation");
  await bulkHistory(false); await bulkDrag(204, 30, 330, 213); await bulkButton("Delete selected").click();
  await check(Promise.resolve((await bulkSaved()).fixtures.length === 0), "Properties also offers bulk delete for mouse and touch use");
  await bulkHistory(false);
  await bulkDrag(-15, -15, 375, 255);
  await check(Promise.resolve(await bulkCount() === 10), "drag selection includes multiple walls and openings as well as objects");
  await bulkDrag(240, 0, 264, 24); group = await bulkSaved();
  await check(Promise.resolve(group.walls.every((w, i) => w.a.x === bulkPlan.walls[i].a.x + 24 && w.a.y === bulkPlan.walls[i].a.y + 24 && w.b.x === bulkPlan.walls[i].b.x + 24) && group.fixtures[0].x === 264 && group.openings[0].t === bulkPlan.openings[0].t && await bulkPage.locator('[data-layer="rooms"] polygon').count() === 2), "moving a whole plan translates every wall once, keeps rooms closed and carries the hosted door");
  await bulkPage.screenshot({ path: resolve(output, "group-selection-properties.png"), fullPage: true });
  await bulkHistory(false); await bulkPage.keyboard.press("Escape");
  await bulkClick(240, 0); await bulkPage.keyboard.down("Shift"); await bulkClick(360, 144); await bulkPage.keyboard.up("Shift");
  await bulkDrag(240, 0, 252, 12); group = await bulkSaved();
  await check(Promise.resolve(group.walls[0].a.x === 0 && group.walls[0].a.y === 12 && group.walls[0].b.x === 372 && group.walls[1].a.x === 372 && group.walls[2].a.x === 372 && group.walls[4].a.x === 180 && group.walls[4].a.y === 12 && group.walls[4].b.x === 180), "moving two walls stretches attached walls while keeping every square junction fixed");
  await bulkHistory(false); await bulkPage.keyboard.press("Escape");
  await bulkClick(240, 0); await bulkDrag(240, 0, 264, 24); group = await bulkSaved();
  await check(Promise.resolve(group.walls[0].a.x === 0 && group.walls[0].a.y === 24 && group.walls[0].b.x === 360 && group.walls[0].b.y === 24 && group.walls[1].b.y === 240 && group.walls[4].a.x === 180 && group.walls[4].a.y === 24 && await bulkPage.locator('[data-layer="rooms"] polygon').count() === 2), "dragging a single wall diagonally preserves perpendicular corners and T junctions");
  await bulkHistory(false); await bulkClick(240, 0);
  await bulkDrag(360, 0, 384, 24); group = await bulkSaved();
  await check(Promise.resolve(group.walls[0].a.x === 0 && group.walls[0].a.y === 24 && group.walls[0].b.x === 384 && group.walls[0].b.y === 24 && group.walls[1].b.x === 384 && group.walls[1].b.y === 240 && group.walls[4].a.x === 180), "dragging a corner endpoint resizes both wall lines without breaking their 90-degree angles");
  await bulkHistory(false); await bulkClick(240, 0);
  await bulkPage.getByRole("spinbutton", { name: "End Y", exact: true }).fill("18");
  await bulkPage.getByRole("spinbutton", { name: "End Y", exact: true }).press("Tab"); group = await bulkSaved();
  await check(Promise.resolve(group.walls[0].a.y === 18 && group.walls[0].b.y === 18 && group.walls[1].a.x === 360 && group.walls[1].b.x === 360), "wall endpoint edits in Properties preserve existing square junctions");
  await bulkHistory(false); await bulkClick(240, 0);
  await bulkPage.getByRole("application").focus(); await bulkPage.keyboard.press("ArrowRight");
  await check(Promise.resolve(isDeepStrictEqual((await bulkSaved()).walls, bulkPlan.walls)), "keyboard nudging cannot tilt perpendicular neighboring walls");
  await bulkPage.keyboard.press("ArrowDown"); group = await bulkSaved();
  await check(Promise.resolve(group.walls[0].a.y === 6 && group.walls[0].b.y === 6 && group.walls[4].a.x === group.walls[4].b.x), "keyboard nudging moves a square wall along its allowed direction");
  await bulkHistory(false); await bulkPage.keyboard.press("Escape");
  await bulkPage.getByRole("application").focus(); await bulkPage.keyboard.press("ControlOrMeta+a");
  await check(Promise.resolve(await bulkCount() === 10), "Select all includes every visible editable element");
  await bulkPage.keyboard.press("Backspace"); group = await bulkSaved();
  await check(Promise.resolve(group.walls.length === 0 && group.openings.length === 0 && group.fixtures.length === 0 && group.notes.length === 0), "bulk wall deletion also removes hosted openings without leaving dangling records");
  await bulkHistory(false); await bulkPage.keyboard.press("Escape");
  await bulkButton("Layers").click(); await bulkPage.getByRole("switch", { name: "Furniture & fixtures", exact: true }).click();
  await bulkDrag(204, 30, 330, 213);
  await check(Promise.resolve(await bulkCount() === 2), "marquee excludes furniture when its layer is hidden");
  await bulkPage.keyboard.press("Escape"); await bulkPage.getByRole("switch", { name: "Furniture & fixtures", exact: true }).click();
  await bulkDrag(204, 30, 330, 213); await bulkDrag(240, 84, 264, 108); await bulkPage.getByRole("application").focus(); await bulkPage.keyboard.press("Escape");
  await bulkPage.waitForTimeout(50);
  await check(Promise.resolve(await bulkPage.locator(".fp-selection-count").count() === 0), "Escape clears the group and restores plan details before saving");
  await bulkButton("Save plan").click(); await bulkPage.getByRole("combobox", { name: "Save plan to client", exact: true }).selectOption("client-alex"); await bulkButton("Save plan to client").click();
  await bulkPage.locator(".fp-client-badge").waitFor();
  await bulkDrag(228, 54, 354, 237); await bulkDrag(264, 108, 276, 120);
  await bulkPage.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.fixtures[0].x === 276);
  await bulkPage.reload(); await bulkPage.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await bulkSaved()).fixtures[0].x === 276 && (await bulkSaved()).notes[0].x === 264), "group moves autosave with the client and survive a refresh");
  await bulkContext.close();

  await check(Promise.resolve(await page.locator('[data-layer="roof"] polygon').count() === 1), "roof generated automatically");
  await check(Promise.resolve(await page.locator('[data-roof-line="ridge"]').count() === 1 && await page.locator('[data-roof-line="hip"]').count() === 4), "default hip roof has corner hips and a centered ridge above the furnished example");
  await check(page.locator('[data-layer="roof"]').evaluate(el => el.getAttribute("opacity") === "0.5" && el.getAttribute("stroke-dasharray") === "7 4" && [...el.querySelectorAll("path, polygon")].every(line => !line.hasAttribute("stroke-dasharray"))), "all roof geometry matches the perimeter dash pattern at 50 percent opacity");
  await check(page.locator('[data-room-dimension]').evaluateAll(elements => new Set(elements.map(e => e.dataset.roomDimension)).size === 4), "all four sample rooms have dimensions near their walls");
  await check(page.locator("[data-room-dimension]").evaluateAll(interiorLabelsCentered), "every interior number is centered along and on its dimension line");
  const livingId = await page.locator('[data-layer="rooms"] polygon').evaluateAll(elements => elements.find(el => el.getAttribute("points").startsWith("3.000,3.000"))?.dataset.id);
  await check(page.locator('[data-room-dimension]').evaluateAll((elements, roomId) => {
    const labels = elements.filter(e => e.dataset.roomDimension === roomId).map(e => e.textContent);
    return labels.includes("6′ 0″") && labels.includes("8′ 9″") && labels.includes("13′ 9″") && labels.includes("10′ 9″") && elements.every(e => !e.querySelector("rect"));
  }, livingId), "living/kitchen interior dimension chains appear near its walls without label backgrounds");
  await check(page.locator('[data-room-dimension]').evaluateAll(elements => elements.every(e => !e.dataset.dimension.endsWith(":overall"))), "interior chains omit redundant overall totals");
  await check(page.locator('[data-opening-dimension]').evaluateAll(elements => {
    const ids = [...new Set(elements.map(e => e.dataset.openingDimension))];
    return ids.length === 4 && ids.every(id => {
      const chain = elements.filter(e => e.dataset.openingDimension === id);
      return chain.length >= 1 && chain.filter(e => e.querySelector("text")).length === 1;
    });
  }), "every doorway has one width label, including shared interior doors");
  await check(page.locator("[data-doorway-dimension]").evaluateAll(elements => elements.length === 4 && elements.every(dim => {
    const opening = [...dim.ownerSVGElement.querySelectorAll('[data-kind="opening"]')].find(el => el.dataset.id === dim.dataset.doorwayDimension);
    const text = dim.querySelector("text");
    const label = text.parentElement.getCTM(), gap = opening.getCTM();
    const ends = dim.querySelector("path").getAttribute("d").match(/[ML][^ML]+/g).map(command => command.slice(1).split(",").map(Number));
    const width = Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);
    return Math.abs(label.e - gap.e) < 1e-7 && Math.abs(label.f - gap.f) < 1e-7 && text.getComputedTextLength() + 3 <= width;
  })), "doorway numbers are centered in the actual gaps and fit between the jambs");
  await check(Promise.resolve(await page.locator('[data-dimension^="exterior:side:"][data-dimension$=":overall"]').count() > 0), "exterior dimensions retain segment chains and overall totals");
  await page.screenshot({ path: resolve(output, "furnished-example.png"), fullPage: true });
  await find("Layers").click();
  await check(find("Hip roof").getAttribute("aria-pressed").then(value => value === "true"), "roof type controls reflect the default hip style");
  await page.screenshot({ path: resolve(output, "hip-roof.png"), fullPage: true });
  await find("Gable roof").click();
  await check(Promise.resolve((await saved()).roofType === "gable" && await page.locator('[data-roof-line="hip"]').count() === 0 && await page.locator('[data-roof-line="ridge"]').count() === 1), "gable toggle replaces corner hips with a full ridge");
  await history(false);
  await check(Promise.resolve((await saved()).roofType === "hip" && await page.locator('[data-roof-line="hip"]').count() === 4), "undo restores hip roof geometry and selection");
  await history(true);
  await check(Promise.resolve((await saved()).roofType === "gable" && await page.locator('[data-roof-line="hip"]').count() === 0), "redo restores gable roof geometry");
  await find("New plan").click();
  await page.getByRole("textbox", { name: "New plan name" }).fill("Browser test house");
  await find("Create plan").click();
  await find("Rectangle").first().click();
  await click(0, 0); await click(360, 240);
  await page.keyboard.press("Escape");
  await check(Promise.resolve((await saved()).walls.length === 4), "draw rectangular exterior footprint");
  await check(Promise.resolve(await page.locator('[data-layer="rooms"] polygon').count() === 1), "rectangle generates a room");
  await check(Promise.resolve(await page.locator('[data-layer="dimensions"] [data-dimension]').count() >= 4), "automatic exterior dimensions appear");
  await find("Interior wall").first().click();
  await click(180, 0); await click(180, 240); await page.keyboard.press("Escape");
  await check(Promise.resolve(await page.locator('[data-layer="rooms"] polygon').count() === 2), "interior partition generates two rooms");
  const originalWalls = (await saved()).walls;
  const applyDimension = async (label, input, fixed) => {
    await label.click();
    await page.getByRole("textbox", { name: "New dimension", exact: true }).fill(input);
    if (fixed) await find(fixed === "end" ? "Move left end" : "Move right end").click();
    await page.getByRole("textbox", { name: "New dimension", exact: true }).press("Enter");
    await page.locator(".fp-dimension-editor").waitFor({ state: "hidden" });
  };
  const northTotal = () => page.locator('[data-dimension="exterior:side:north:overall"] [data-edit-dimension]');
  await northTotal().click();
  await check(Promise.resolve(await page.getByRole("dialog").count() === 0 && await page.getByRole("textbox", { name: "New dimension", exact: true }).evaluate(el => document.activeElement === el && el.selectionEnd === el.value.length && el.selectionStart === 0)), "dimension editing opens an inline selected input without a modal or backdrop");
  await check(page.locator(".fp-dimension-editor").evaluate(el => {
    const label = document.querySelector('[data-dimension="exterior:side:north:overall"] [data-edit-dimension]').getBoundingClientRect(), box = el.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - label.x - label.width / 2) < 3 && Math.abs(box.y - label.y) < 24;
  }), "inline input sits directly over the clicked measurement");
  await check(page.locator(".fp-dimension-editor").evaluate(el => {
    const b = el.getBoundingClientRect();
    return b.width <= 190 && b.height <= 38 && el.querySelectorAll("button").length === 2 && !el.querySelector("select") && !el.querySelector('button[type="submit"]');
  }), "dimension editor is only a small input between two arrows with no dropdown or confirm/cancel buttons");
  await check(Promise.resolve(await find("Move right end").getAttribute("aria-pressed") === "true" && await find("Move left end").getAttribute("aria-pressed") === "false"), "highlighted right arrow identifies the end that moves by default");
  await find("Move left end").click();
  await check(Promise.resolve(await find("Move left end").getAttribute("aria-pressed") === "true" && await find("Move right end").getAttribute("aria-pressed") === "false" && await page.getByRole("textbox", { name: "New dimension", exact: true }).evaluate(el => document.activeElement === el)), "arrow toggle highlights the moving left end and keeps typing focus in the input");
  await find("Move right end").click();
  await page.mouse.move(1000, 260); await page.mouse.wheel(0, -100);
  await page.waitForTimeout(150);
  await check(page.locator(".fp-dimension-editor").evaluate(el => {
    const label = document.querySelector('[data-dimension="exterior:side:north:overall"] [data-edit-dimension]').getBoundingClientRect(), box = el.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - label.x - label.width / 2) < 3 && Math.abs(box.y - label.y) < 24;
  }), "inline dimension input follows its measurement when zooming the drawing");
  await page.getByRole("textbox", { name: "New dimension", exact: true }).fill("32");
  await page.screenshot({ path: resolve(output, "edit-dimension-inline.png"), fullPage: true });
  await page.getByRole("textbox", { name: "New dimension", exact: true }).press("Enter");
  await page.locator(".fp-dimension-editor").waitFor({ state: "hidden" });
  let resized = await saved();
  await check(Promise.resolve(resized.walls[1].a.x === 384 && resized.walls[1].b.x === 384 && resized.walls[2].a.x === 384 && resized.walls[4].a.x === 180 && await page.locator('[data-layer="rooms"] polygon').count() === 2), "an unmarked exterior dimension defaults to feet and moves the connected end wall and corners");
  await check(page.locator('[data-layer="roof"] polygon').evaluate(el => el.getAttribute("points").split(" ").some(point => Math.abs(Number(point.split(",")[0]) - 405) < .01)), "roof lines regenerate to the edited house width");
  await history(false); await history(true);
  await check(Promise.resolve((await saved()).walls[1].a.x === 384), "dimension edits undo and redo as one connected wall change");
  await history(false);
  await northTotal().click();
  await page.getByRole("textbox", { name: "New dimension", exact: true }).fill("999");
  await page.keyboard.press("Escape");
  await check(Promise.resolve(await page.locator(".fp-dimension-editor").count() === 0 && isDeepStrictEqual((await saved()).walls, originalWalls)), "Escape cancels inline edits and leaves the connected walls unchanged");
  await northTotal().click();
  await page.getByRole("textbox", { name: "New dimension", exact: true }).fill("999");
  await click(40, 60);
  await check(Promise.resolve(await page.locator(".fp-dimension-editor").count() === 0 && isDeepStrictEqual((await saved()).walls, originalWalls)), "clicking back into the drawing cancels unsubmitted input and selects normally");
  const westRoomId = await page.locator('[data-layer="rooms"] polygon').evaluateAll(elements => elements.find(el => el.getAttribute("points").startsWith("3.000,3.000"))?.dataset.id);
  const insideWidth = () => page.locator(`[data-room-dimension="${westRoomId}"] [data-edit-dimension]`).filter({ hasText: "14′ 6¾″" }).first();
  await applyDimension(insideWidth(), '186.75"');
  resized = await saved();
  await check(Promise.resolve(resized.walls[4].a.x === 192 && resized.walls[4].b.x === 192 && isDeepStrictEqual(resized.walls.slice(0, 4), originalWalls.slice(0, 4))), "clicking an interior dimension accepts decimal inches and moves the partition with both ends attached");
  await history(false);
  await applyDimension(insideWidth(), '15\' 6 3/4"', "end");
  resized = await saved();
  await check(Promise.resolve(resized.walls[3].a.x === -12 && resized.walls[3].b.x === -12 && resized.walls[4].a.x === 180), "fractional feet/inches and the left arrow move the left wall");
  await history(false);
  await insideWidth().click();
  await page.getByRole("textbox", { name: "New dimension", exact: true }).fill("bad input"); await page.getByRole("textbox", { name: "New dimension", exact: true }).press("Enter");
  await check(Promise.resolve((await page.locator(".fp-dimension-editor").textContent()).includes("Enter feet") && isDeepStrictEqual((await saved()).walls, originalWalls)), "invalid dimension input leaves the drawing unchanged and reports how to enter lengths");
  await page.getByRole("textbox", { name: "New dimension", exact: true }).fill('400"'); await page.getByRole("textbox", { name: "New dimension", exact: true }).press("Enter");
  await check(Promise.resolve(await page.locator(".fp-form-error").count() === 1 && isDeepStrictEqual((await saved()).walls, originalWalls)), "an edit that would cross a room is rejected without disconnecting the drawing");
  await page.getByRole("textbox", { name: "New dimension", exact: true }).press("Escape");
  await click(60, 100);
  await page.getByRole("textbox", { name: "Room name" }).fill("Living room");
  await page.getByRole("textbox", { name: "Room name" }).press("Tab");
  await find("Oak flooring").click();
  await check(Promise.resolve(Object.values((await saved()).rooms).some(r => r.name === "Living room" && r.finish === "wood")), "name rooms and apply flooring finishes");
  await find("Door").first().click(); await click(90, 240);
  await find("Window").first().click(); await click(90, 0);
  await check(Promise.resolve((await saved()).openings.length === 2), "place door and window on walls");
  // The second window overlaps the first and must be rejected.
  await click(90, 0);
  await check(Promise.resolve((await saved()).openings.length === 2), "overlapping openings are rejected");
  await check(Promise.resolve(await find("Flip hinge side").count() === 0), "window properties do not show door hinge controls");
  await page.keyboard.press("Escape");
  await click(90, 0);
  const windowPosition = page.getByRole("spinbutton", { name: "Position along wall", exact: true });
  await windowPosition.fill("0"); await windowPosition.press("Tab");
  let clearanceWindow = (await saved()).openings.find(o => o.kind === "window");
  await check(Promise.resolve(Math.abs(360 * clearanceWindow.t - clearanceWindow.width / 2 - 3 - 4) < 1e-8), "window position in Properties clamps its jamb four inches from the adjacent wall face");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).fill("60");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).press("Tab");
  clearanceWindow = (await saved()).openings.find(o => o.kind === "window");
  await check(Promise.resolve(clearanceWindow.width === 60 && Math.abs(360 * clearanceWindow.t - 30 - 3 - 4) < 1e-8), "resizing a window at a corner keeps four inches of clearance");
  await history(false); await history(false);
  await drag(90, 0, 8, 0);
  clearanceWindow = (await saved()).openings.find(o => o.kind === "window");
  await check(Promise.resolve(Math.abs(360 * clearanceWindow.t - clearanceWindow.width / 2 - 3 - 4) < 1e-8), "dragging a window toward a corner stops at four inches of clearance");
  await history(false);
  await find("Window").first().click(); await click(8, 0);
  let windowClearancePlan = await saved();
  await check(Promise.resolve(windowClearancePlan.openings.length === 3 && windowClearancePlan.openings.some(o => o.kind === "window" && Math.abs(360 * o.t - o.width / 2 - 3 - 4) < 1e-8)), "placing a window near a corner snaps to four inches of clearance");
  await page.keyboard.press("Escape"); await history(false);
  await click(90, 0);
  await windowPosition.fill("180"); await windowPosition.press("Tab");
  clearanceWindow = (await saved()).openings.find(o => o.kind === "window");
  await check(Promise.resolve(Math.abs(Math.abs(360 * clearanceWindow.t - 180) - clearanceWindow.width / 2 - 2.25 - 4) < 1e-8), "windows keep four inches from interior T-junction wall faces");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).fill("240");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).press("Tab");
  await check(Promise.resolve((await saved()).openings.find(o => o.kind === "window").width === clearanceWindow.width), "a window too wide for any safe span is rejected without changing its width");
  await history(false);
  await check(Promise.resolve(await page.locator('[data-opening-dimension] [data-edit-dimension]').count() === 0), "door and window width labels are read-only on the drawing");
  await click(90, 240);
  await check(Promise.resolve(await page.locator(".fp-dimension-editor").count() === 0 && await page.getByRole("spinbutton", { name: "Opening width", exact: true }).inputValue() === "36"), "clicking the doorway selects its Properties instead of opening the inline dimension editor");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).fill("42");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).press("Tab");
  await check(Promise.resolve((await saved()).openings.find(o => o.kind === "door").width === 42), "door widths are editable through Properties");
  await history(false);
  await check(Promise.resolve((await saved()).openings.find(o => o.kind === "door").width === 36), "undo restores the door width before editing its hinge settings");
  await click(90, 240);
  const doorPosition = page.getByRole("spinbutton", { name: "Position along wall", exact: true });
  await doorPosition.fill("360"); await doorPosition.press("Tab");
  let clearanceDoor = (await saved()).openings.find(o => o.kind === "door");
  await check(Promise.resolve(Math.abs(360 * (1 - clearanceDoor.t) - clearanceDoor.width / 2 - 3 - 4) < 1e-8), "door position in Properties clamps to four inches from the adjacent wall face");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).fill("42");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).press("Tab");
  clearanceDoor = (await saved()).openings.find(o => o.kind === "door");
  await check(Promise.resolve(clearanceDoor.width === 42 && Math.abs(360 * (1 - clearanceDoor.t) - 21 - 3 - 4) < 1e-8), "resizing a door next to a corner preserves four inches of clear wall");
  await history(false); await history(false);
  await drag(90, 240, 8, 240);
  clearanceDoor = (await saved()).openings.find(o => o.kind === "door");
  await check(Promise.resolve(Math.abs(360 * (1 - clearanceDoor.t) - 25) < 1e-8), "dragging a door toward a corner stops its jamb four inches from the wall face");
  await history(false);
  await find("Door").first().click(); await click(8, 240);
  let clearancePlan = await saved();
  await check(Promise.resolve(clearancePlan.openings.length === 3 && clearancePlan.openings.some(o => o.kind === "door" && Math.abs(360 * (1 - o.t) - 25) < 1e-8)), "placing a door near a corner automatically leaves four inches of clearance");
  await page.keyboard.press("Escape"); await history(false);
  await click(90, 240);
  await doorPosition.fill("180"); await doorPosition.press("Tab");
  clearanceDoor = (await saved()).openings.find(o => o.kind === "door");
  await check(Promise.resolve(Math.abs(Math.abs(360 * (1 - clearanceDoor.t) - 180) - clearanceDoor.width / 2 - 2.25 - 4) < 1e-8), "doors also stop four inches from the face of an interior T junction");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).fill("240");
  await page.getByRole("spinbutton", { name: "Opening width", exact: true }).press("Tab");
  await check(Promise.resolve((await saved()).openings.find(o => o.kind === "door").width === 36), "an oversized door with no safe wall span is rejected without altering the opening");
  await history(false);
  await click(108, 208);
  const hingeToggle = find("Flip hinge side");
  await check(Promise.resolve(await hingeToggle.getAttribute("aria-pressed") === "false"), "new doors start with a left hinge and expose the flip hinge button");
  await check(page.locator(".fp-door-controls").evaluate(el => {
    const [hinge, swing] = el.querySelectorAll("button");
    return swing.getBoundingClientRect().top - hinge.getBoundingClientRect().bottom >= 8;
  }), "hinge and swing flip buttons have eight pixels of spacing");
  let doorFlip = false;
  for (const [hinge, flip] of [["left", false], ["right", false], ["right", true], ["left", true], ["right", true]]) {
    if ((await hingeToggle.getAttribute("aria-pressed") === "true" ? "right" : "left") !== hinge) await hingeToggle.click();
    if (doorFlip !== flip) { await find("Flip door swing").click(); doorFlip = flip; }
    const door = (await saved()).openings.find(o => o.kind === "door");
    await check(page.locator('[data-door-leaf]').evaluate((leaf, expected) => {
      const opening = leaf.closest('[data-kind="opening"]');
      const relative = opening.getCTM().inverse().multiply(leaf.getCTM());
      const start = new DOMPoint(0, 0).matrixTransform(relative);
      const tip = new DOMPoint(0, expected.width).matrixTransform(relative);
      const jamb = (expected.hinge === "right" ? 1 : -1) * expected.width / 2;
      return Math.abs(start.x - jamb) < 1e-7 && Math.abs(start.y) < 1e-7 && Math.abs(tip.x - jamb) < 1e-7 && Math.abs(tip.y - (expected.flip ? -1 : 1) * expected.width) < 1e-7;
    }, { hinge, flip, width: door.width }), `${hinge} hinge renders at its jamb with ${flip ? "flipped" : "original"} swing direction`);
    assert.equal(door.hinge, hinge); assert.equal(door.flip, flip);
  }
  await history(false);
  await check(Promise.resolve(await hingeToggle.getAttribute("aria-pressed") === "false" && (await saved()).openings.find(o => o.kind === "door").flip), "undo restores the previous hinge without changing the swing side");
  await history(true);
  await check(Promise.resolve(await hingeToggle.getAttribute("aria-pressed") === "true"), "redo restores the right hinge");
  await page.screenshot({ path: resolve(output, "door-hinge-properties.png"), fullPage: true });
  const dimensionsBeforeNotes = await interiorArtwork();
  await find("Textbox").first().click(); await click(384, 54);
  const noteText = "CONSTRUCTION NOTES\n1. Remove existing partition.\n2. Verify dimensions on site.\n3. Install 36 inch door.";
  await page.getByRole("textbox", { name: "Construction note", exact: true }).fill(noteText);
  await page.getByRole("textbox", { name: "Construction note", exact: true }).press("Tab");
  await page.getByRole("spinbutton", { name: "Textbox width" }).fill("168");
  await page.getByRole("spinbutton", { name: "Textbox width" }).press("Tab");
  await page.getByRole("combobox", { name: "Text size" }).selectOption("10");
  await check(Promise.resolve((await saved()).notes[0].text === noteText && (await saved()).notes[0].width === 168), "Textbox places an editable multiline construction note");
  await check(page.locator('[data-layer="notes"] text').evaluate(el => [...el.querySelectorAll("tspan")].every(line => line.getComputedTextLength() <= 168 - 16)), "construction note lines wrap within the textbox width");
  await page.getByRole("switch", { name: "Textbox border" }).click();
  await check(Promise.resolve(!(await saved()).notes[0].border), "textbox border can be hidden independently");
  await page.getByRole("switch", { name: "Textbox border" }).click();
  await drag(392, 62, 416, 86);
  await check(Promise.resolve((await saved()).notes[0].x === 408 && (await saved()).notes[0].y === 78), "construction notes drag with grid snapping");
  const resize = await page.locator('[data-kind="text"][data-end="b"]').evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom: el.getScreenCTM().a }; });
  await page.mouse.move(resize.x, resize.y); await page.mouse.down(); await page.mouse.move(resize.x + 24 * resize.zoom, resize.y, { steps: 8 }); await page.mouse.up();
  await check(Promise.resolve((await saved()).notes[0].width === 192), "textbox width resizes with its right handle");
  await find("Copy").click();
  await check(Promise.resolve((await saved()).notes.length === 2 && (await saved()).notes[0].id !== (await saved()).notes[1].id), "construction notes copy with distinct identities");
  await find("Delete").click(); await history(false);
  await check(Promise.resolve((await saved()).notes.length === 2), "undo restores a deleted construction note");
  await history(true);
  await check(Promise.resolve((await saved()).notes.length === 1 && isDeepStrictEqual(dimensionsBeforeNotes, await interiorArtwork())), "notes do not affect interior dimensions");
  await find("Layers").click(); await page.getByRole("switch", { name: "Construction notes", exact: true }).click();
  await check(Promise.resolve(await page.locator('[data-layer="notes"]').count() === 0), "construction notes have a separate visibility layer");
  await page.getByRole("switch", { name: "Construction notes", exact: true }).click();
  await page.screenshot({ path: resolve(output, "construction-notes.png"), fullPage: true });
  const dimensionsBeforeFixtures = await interiorArtwork();
  await find("Objects").click();
  await find("Place Queen bed").click(); await click(270, 96); await page.keyboard.press("Escape");
  await click(270, 96);
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("72");
  await page.getByRole("spinbutton", { name: "Width", exact: true }).press("Tab");
  await find("Rotate").click();
  await check(Promise.resolve((await saved()).fixtures[0].width === 72 && (await saved()).fixtures[0].rotation === 90), "resize and rotate furniture");
  await drag(270, 96, 294, 120);
  await check(Promise.resolve((await saved()).fixtures[0].x === 294 && (await saved()).fixtures[0].y === 120), "drag furniture with grid snapping");
  await check(Promise.resolve(isDeepStrictEqual(dimensionsBeforeFixtures, await interiorArtwork())), "placing, resizing, rotating and moving furniture leaves interior dimension lines and labels unchanged");
  await find("Copy").click();
  await check(Promise.resolve((await saved()).fixtures.length === 2), "duplicate selected furniture");
  await find("Delete").click();
  await check(Promise.resolve((await saved()).fixtures.length === 1), "delete selected furniture");
  await history(false);
  await check(Promise.resolve((await saved()).fixtures.length === 2), "undo restores deleted furniture");
  await history(true);
  await check(Promise.resolve((await saved()).fixtures.length === 1), "redo reapplies deletion");
  await find("Bathroom").click(); await find("Place Toilet").click(); await click(240, 192); await page.keyboard.press("Escape");
  await check(Promise.resolve((await saved()).fixtures.some(f => f.catalogId === "toilet")), "place bathroom fixtures");
  await find("Place Roll-in shower").click();
  const showerPreviewPoint = await world(24, 24); await page.mouse.move(showerPreviewPoint.x, showerPreviewPoint.y);
  await check(page.getByRole("application").locator('[data-fixture-preview]').evaluate(el => el.getAttribute("transform") === "translate(27 27) rotate(0)"), "object placement preview snaps its edges to both inside wall faces");
  await click(24, 24); await page.keyboard.press("Escape");
  let placedShower = (await saved()).fixtures.find(f => f.catalogId === "shower");
  await check(Promise.resolve(placedShower.x === 27 && placedShower.y === 27), "a shower can touch both corner walls without a grid gap or wall penetration");
  await check(page.locator(`[data-kind="fixture"][data-id="${placedShower.id}"]`).evaluate(el => {
    const footprint = el.querySelector('g rect'), matrix = el.getCTM().inverse().multiply(footprint.getCTM());
    const a = new DOMPoint(Number(footprint.getAttribute("x")), Number(footprint.getAttribute("y"))).matrixTransform(matrix);
    const b = new DOMPoint(Number(footprint.getAttribute("x")) + Number(footprint.getAttribute("width")), Number(footprint.getAttribute("y")) + Number(footprint.getAttribute("height"))).matrixTransform(matrix);
    return Math.abs(a.x + 24) < 1e-4 && Math.abs(a.y + 24) < 1e-4 && Math.abs(b.x - 24) < 1e-4 && Math.abs(b.y - 24) < 1e-4;
  }), "the visible shower silhouette fills its physical dimensions without decorative inset");
  await page.screenshot({ path: resolve(output, "shower-against-wall-faces.png"), fullPage: true });
  await drag(27, 40, 153, 37);
  placedShower = (await saved()).fixtures.find(f => f.catalogId === "shower");
  await check(Promise.resolve(placedShower.x === 153.75 && placedShower.y === 27), "dragging an object snaps to an interior wall face with its actual thickness");
  await history(false);
  await check(Promise.resolve((await saved()).fixtures.find(f => f.catalogId === "shower").x === 27), "a wall-snapped object move undoes in one step");
  await find("Snap on").click(); await drag(27, 40, 25.5, 45.5);
  placedShower = (await saved()).fixtures.find(f => f.catalogId === "shower");
  await check(Promise.resolve(Math.abs(placedShower.x - 25.5) < 1e-4 && Math.abs(placedShower.y - 32.5) < 1e-4), "turning Snap off keeps precise free positioning available");
  await history(false); await find("Snap off").click(); await history(false);
  await check(Promise.resolve(isDeepStrictEqual(dimensionsBeforeFixtures, await interiorArtwork())), "adding and removing furniture and bathroom fixtures leaves all interior dimensions unchanged");
  await find("Systems").click(); await find("Cold-water supply").click(); await click(240, 216); await click(324, 216); await page.keyboard.press("Escape");
  await find("Electrical circuit").click(); await click(30, 60); await click(144, 60); await page.keyboard.press("Escape");
  await check(Promise.resolve((await saved()).utilities.length === 2), "route plumbing and electrical runs");
  await find("Layers").click();
  await find("Hip roof").click();
  await page.getByRole("spinbutton", { name: "Roof overhang" }).fill("24");
  await page.getByRole("spinbutton", { name: "Roof overhang" }).press("Tab");
  await check(Promise.resolve((await saved()).roofOverhang === 24), "edit the generated roof overhang");
  await page.getByRole("switch", { name: "Roof structure", exact: true }).click();
  await check(Promise.resolve(await page.locator('[data-layer="roof"]').count() === 0), "toggle drawing layers");
  await page.getByRole("switch", { name: "Roof structure", exact: true }).click();
  // Resize the east wall through Properties; adjacent corners stay connected.
  await find("Select").click(); await click(360, 170);
  await page.getByRole("spinbutton", { name: "Wall length" }).fill("300");
  await page.getByRole("spinbutton", { name: "Wall length" }).press("Tab");
  await check(Promise.resolve(await page.locator('[data-layer="roof"] polygon').count() === 1), "wall edits keep connected exterior corners and roof");
  await history(false);
  const beforeReload = await saved();
  await page.reload(); await page.getByRole("application").waitFor();
  const afterReload = await saved();
  await check(Promise.resolve(isDeepStrictEqual(beforeReload, afterReload)), "autosave restores all elements on reload");
  await check(Promise.resolve(afterReload.roofType === "hip" && await page.locator('[data-roof-line="hip"]').count() === 4), "reload preserves the roof style and regenerates its structure");
  await check(Promise.resolve(afterReload.openings.find(o => o.kind === "door").hinge === "right" && afterReload.openings.find(o => o.kind === "door").flip), "reload preserves independent door hinge and swing settings");
  await check(Promise.resolve(afterReload.notes.length === 1 && afterReload.notes[0].text === noteText), "reload preserves construction notes and their editable text");
  await page.screenshot({ path: resolve(output, "drafted-plan.png"), fullPage: true });
  await find("Export").click();
  const backupDownload = Promise.race([page.waitForEvent("download"), page.locator(".fp-notice.is-error").waitFor({ state: "visible" }).then(async () => { throw new Error(await page.locator(".fp-notice.is-error").textContent()); })]); await find("JSON backup").click();
  const backup = await backupDownload; const backupPath = resolve(output, "backup.sah-plan.json"); await backup.saveAs(backupPath);
  const json = JSON.parse(await readFile(backupPath, "utf8"));
  await check(Promise.resolve(json.walls.length === 5 && json.fixtures.length === 2 && json.utilities.length === 2), "export editable JSON backup");
  await check(Promise.resolve(json.openings.find(o => o.kind === "door").hinge === "right"), "editable backup includes the selected door hinge");
  await check(Promise.resolve(json.notes[0].text === noteText), "editable backup includes construction notes");
  const svgDownload = page.waitForEvent("download"); await find("SVG drawing").click(); const svg = await svgDownload; const svgPath = resolve(output, "drawing.svg"); await svg.saveAs(svgPath);
  await check(Promise.resolve((await readFile(svgPath, "utf8")).includes('data-layer="dimensions"')), "export vector SVG with dimensions");
  await check(Promise.resolve((await readFile(svgPath, "utf8")).includes('data-room-dimension=')), "export includes interior room dimensions");
  await check(Promise.resolve((await readFile(svgPath, "utf8")).includes('data-roof-line="hip"') && (await readFile(svgPath, "utf8")).includes('data-roof-line="ridge"')), "SVG export includes the selected roof's hips and ridge");
  const svgText = await readFile(svgPath, "utf8");
  await check(page.evaluate(text => {
    const svg = new DOMParser().parseFromString(text, "image/svg+xml");
    const note = svg.querySelector('[data-layer="notes"] [data-kind="text"]');
    const box = svg.documentElement.getAttribute("viewBox").split(" ").map(Number);
    return note?.textContent.includes("CONSTRUCTION NOTES") && box[0] + box[2] > 408 + 192;
  }, svgText), "SVG export includes the wrapped construction note and its entire box outside the house");
  await check(page.evaluate(text => {
    const door = new DOMParser().parseFromString(text, "image/svg+xml").querySelector('[data-door-hinge="right"]');
    return door?.getAttribute("transform") === "translate(18 0) scale(-1 -1)" && !!door.querySelector('[data-door-leaf]');
  }, svgText), "SVG export mirrors the right hinge and retains the flipped swing");
  await check(page.evaluate(interiorLabelsCentered, svgText), "exported interior labels are centered on their dimension lines");
  const paints = [...svgText.matchAll(/(?:fill|stroke|color)="(#[0-9a-f]+)"/gi)].map(match => match[1].slice(1));
  await check(Promise.resolve(paints.length > 10 && paints.every(hex => hex.length === 3 ? hex[0] === hex[1] && hex[1] === hex[2] : hex.slice(0, 2) === hex.slice(2, 4) && hex.slice(2, 4) === hex.slice(4, 6))), "SVG artwork, fixtures, roof, labels and finish patterns use only monochrome colors");
  await check(page.evaluate(async svgText => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    try {
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2]) return false; if (pixels[i] < 128) ink++; }
      return ink > 1000;
    } finally { URL.revokeObjectURL(url); }
  }, svgText), "rendered export pixels are black and white with visible drawing ink");
  const scaleSelect = page.getByRole("combobox", { name: "PDF drawing scale" });
  await check(Promise.resolve(await scaleSelect.inputValue() === "fit-a4"), "Fit to A4 page is the default PDF export option");
  const preview = await page.locator(".fp-export-card .fp-field-note").textContent();
  const a4Download = page.waitForEvent("download"); await find("Download PDF").click(); const a4 = await a4Download;
  const a4Path = resolve(output, "drawing-a4.pdf"); await a4.saveAs(a4Path);
  const { PDFDocument, PDFArray } = webRequire("pdf-lib");
  const a4Document = await PDFDocument.load(await readFile(a4Path));
  const a4Page = a4Document.getPages()[0];
  await check(Promise.resolve(a4Document.getPages().length === 1 && Math.abs(a4Page.getWidth() * 25.4 / 72 - 297) < 1e-8 && Math.abs(a4Page.getHeight() * 25.4 / 72 - 210) < 1e-8), "default PDF fits onto one accurately sized landscape A4 page");
  const ratio = Number(preview.match(/Scale 1:(\d+)/)[1]);
  await check(Promise.resolve(a4Document.getSubject().includes(`Scale 1:${ratio}`)), "downloaded PDF and export preview report the same calculated scale");
  const streamRefs = a4Page.node.Contents();
  const streams = streamRefs instanceof PDFArray ? streamRefs.asArray().map(ref => a4Document.context.lookup(ref)) : [streamRefs];
  const operators = streams.map(stream => inflateSync(stream.getContents()).toString()).join("\n");
  const imageMatrix = [...operators.matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm/g)].map(match => [Number(match[1]), Number(match[2])]).find(([w, h]) => w > 10 && h > 10);
  const viewBox = svgText.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  await check(Promise.resolve(imageMatrix && Math.abs(imageMatrix[0] / viewBox[2] - 72 / ratio) < 1e-8 && Math.abs(imageMatrix[1] / viewBox[3] - 72 / ratio) < 1e-8), "PDF image geometry uses the exact printed scale on both axes");
  await page.screenshot({ path: resolve(output, "export-a4-dialog.png") });
  await scaleSelect.selectOption("0.25");
  const pdfDownload = page.waitForEvent("download"); await find("Download PDF").click(); const pdf = await pdfDownload; const pdfPath = resolve(output, "drawing.pdf"); await pdf.saveAs(pdfPath);
  await check(Promise.resolve((await readFile(pdfPath)).subarray(0, 4).toString() === "%PDF"), "export scaled PDF");
  const document = await PDFDocument.load(await readFile(pdfPath));
  await check(Promise.resolve(document.getPages().length === 1 && document.getPages()[0].getWidth() === 1224 && document.getSubject().includes("1:48")), "standard 1/4 inch scale remains available and auto-selects tabloid paper");
  await find("Close dialog").click();
  await page.locator('input[type="file"]').setInputFiles(backupPath);
  await check(Promise.resolve((await saved()).walls.length === 5), "import backup into a new editable project");
  await find("My plans").click();
  await check(Promise.resolve(await page.locator(".fp-local-projects .fp-project-row").count() === 3), "library preserves sample, drawing, and imported projects");
  await find("Close dialog").click();
  await find("New plan").click();
  await page.getByRole("textbox", { name: "New plan name" }).fill("Concave roof test");
  await find("Create plan").click();
  await find("Exterior wall").first().click();
  for (const [x, y] of [[0, 0], [360, 0], [360, 120], [180, 120], [180, 240], [0, 240], [0, 0]]) await click(x, y);
  await page.keyboard.press("Escape");
  await check(Promise.resolve((await saved()).walls.length === 6 && await page.locator('[data-layer="roof"] polygon').count() === 1), "draw a connected L-shaped exterior and automatic concave roof");
  await check(Promise.resolve(await page.locator('[data-roof-line="valley"]').count() > 0 && await page.locator('[data-roof-line="ridge"]').count() > 0), "default L-shaped hip roof includes intersecting ridges and valleys");
  await find("Open roof settings").click();
  await find("Hip roof").click();
  await check(Promise.resolve((await saved()).roofType === "hip" && await page.locator('[data-roof-line="valley"]').count() > 0 && await page.locator('[data-roof-line="hip"]').count() > 0), "roof status opens settings and a concave hip roof retains its valleys");
  await page.screenshot({ path: resolve(output, "concave-hip-roof.png"), fullPage: true });
  await find("Build").click();
  await page.getByRole("spinbutton", { name: "Exact next wall length" }).fill("120");
  await page.getByRole("spinbutton", { name: "Exact next wall length" }).press("Tab");
  await find("Exterior wall").first().click();
  await click(360, 240); await click(414, 240); await page.keyboard.press("Escape");
  const exactWall = (await saved()).walls.at(-1);
  await check(Promise.resolve(Math.hypot(exactWall.b.x - exactWall.a.x, exactWall.b.y - exactWall.a.y) === 120), "draw walls to an exact entered length");
  await page.getByRole("spinbutton", { name: "Exact next wall length" }).fill("0");
  await page.getByRole("spinbutton", { name: "Exact next wall length" }).press("Tab");
  await find("Interior wall").first().click(); await drag(90, 0, 90, 240); await page.keyboard.press("Escape");
  await check(Promise.resolve(await page.locator('[data-layer="rooms"] polygon').count() === 2), "draw interior partitions by dragging");
  // Reproduce the reported side-name/wall-name collision with an inset west wall.
  const keyRegression = { ...json, id: "dimension-key-regression", name: "Dimension key regression", openings: [], fixtures: [], utilities: [], rooms: {}, walls: [
    { id: "north", a: { x: 0, y: 0 }, b: { x: 240, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "east", a: { x: 240, y: 0 }, b: { x: 240, y: 180 }, kind: "exterior", thickness: 6 },
    { id: "south", a: { x: 240, y: 180 }, b: { x: 0, y: 180 }, kind: "exterior", thickness: 6 },
    { id: "west", a: { x: 0, y: 180 }, b: { x: 0, y: 0 }, kind: "exterior", thickness: 6 },
    { id: "outer-west", a: { x: -48, y: 60 }, b: { x: -48, y: 120 }, kind: "exterior", thickness: 6 },
    { id: "offset-corner", a: { x: 120, y: 90 }, b: { x: 156, y: 126 }, kind: "exterior", thickness: 6 },
  ] };
  await page.locator('input[type="file"]').setInputFiles({ name: "dimension-key-regression.sah-plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(keyRegression)) });
  await page.waitForFunction(() => document.querySelector('input[aria-label="Plan name"]')?.value === "Dimension key regression");
  await check(page.locator('[data-dimension]').evaluateAll(elements => new Set(elements.map(e => e.dataset.dimension)).size === elements.length), "inset named walls render all dimensions with unique keys");
  await check(Promise.resolve(await find("Ortho on").getAttribute("aria-pressed") === "true"), "restored editor defaults enable straight wall drawing");
  await find("Interior wall").first().click(); await click(0, 84); await click(120, 89); await page.keyboard.press("Escape");
  const straightWall = (await saved()).walls.at(-1);
  await check(Promise.resolve(straightWall.a.y === 84 && straightWall.b.y === 84 && straightWall.b.x === 120), "nearby off-axis endpoints cannot pull a newly drawn wall out of line");
  await history(false);
  await find("Interior wall").first().click(); await click(0, 84); await page.keyboard.down("Shift"); await click(120, 89); await page.keyboard.up("Shift"); await page.keyboard.press("Escape");
  const shiftWall = (await saved()).walls.at(-1);
  await check(Promise.resolve(shiftWall.a.y === 84 && shiftWall.b.y === 90), "holding Shift still permits angled walls and endpoint snapping");
  await history(false);
  await find("Ortho on").click(); await find("Interior wall").first().click(); await drag(0, 84, 120, 89); await page.keyboard.press("Escape");
  const freeWall = (await saved()).walls.at(-1);
  await check(Promise.resolve(freeWall.a.y === 84 && freeWall.b.y === 90), "Ortho off still allows angled walls when dragging");
  await history(false); await find("Ortho off").click();
  await find("My plans").click(); await page.locator(".fp-local-projects .fp-project-open").filter({ hasText: "Concave roof test" }).click();
  // The real editor uses this same gateway with Convex mutations and queries.
  await find("Save plan").click(); await find("Create new client").click();
  await page.getByRole("textbox", { name: "Client name", exact: true }).fill("Morgan New Client");
  await page.screenshot({ path: resolve(output, "create-client.png"), fullPage: true });
  await find("Create client & save plan").click();
  await page.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await page.locator(".fp-client-badge").textContent()).includes("Morgan New Client")), "create a client and save the current editable plan");
  const serverSaved = () => page.evaluate(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")));
  let cloud = await serverSaved();
  await check(Promise.resolve(cloud.clients.length === 2 && cloud.records.length === 1 && cloud.records[0].plan.walls.length === 8), "client creation preserves all geometry and creates one plan");
  await check(Promise.resolve(cloud.records[0].plan.roofType === "hip"), "client save preserves the selected roof type");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).fill("Morgan renovation");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).press("Tab");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.name === "Morgan renovation");
  await check(Promise.resolve((await serverSaved()).records[0].summary.revision === 2), "linked edits autosave to the client with an updated revision");
  await page.reload(); await page.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await page.locator(".fp-client-badge").textContent()).includes("Morgan New Client")), "reload restores the client association");
  await applyDimension(northTotal(), '31\' 0"');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.walls[0].b.x === 372);
  await page.reload(); await page.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await saved()).walls[0].b.x === 372 && (await serverSaved()).records[0].plan.walls[0].b.x === 372), "edited dimensions autosave with the client and reopen with the resized walls");
  await find("Change plan client").click();
  await page.getByRole("combobox", { name: "Save plan to client" }).selectOption("client-alex");
  await find("Save plan to client").click();
  await page.waitForFunction(() => document.querySelector(".fp-client-badge")?.textContent.includes("Alex Existing"));
  await check(Promise.resolve((await serverSaved()).records.length === 1), "reassign to an existing client without duplicating the plan");
  await page.screenshot({ path: resolve(output, "client-linked-plan.png"), fullPage: true });
  // Clearing local data emulates opening this workspace from another device.
  await page.evaluate(k => { localStorage.removeItem(k); localStorage.removeItem(`${k}:client-links`); }, key);
  await page.reload(); await find("My plans").click();
  await find("Open Morgan renovation for Alex Existing").click();
  await check(Promise.resolve((await saved()).name === "Morgan renovation" && (await saved()).walls.length === 8), "reopen a client plan after clearing the local draft cache");
  await page.evaluate(() => { window.testSaveDelay = 900; });
  await find("Save plan").click();
  await page.getByRole("textbox", { name: "Plan name", exact: true }).fill("Edited during save");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).press("Tab");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.name === "Edited during save");
  await check(Promise.resolve(true), "edits made during an in-flight save are saved afterward");
  await page.evaluate(() => { window.testSaveDelay = 150; window.testSaveFailure = "Connection unavailable. Your local draft is kept."; });
  await page.getByRole("textbox", { name: "Plan name", exact: true }).fill("Offline edit");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).press("Tab");
  await page.locator(".fp-cloud-warning").waitFor();
  await check(Promise.resolve((await saved()).name === "Offline edit" && (await serverSaved()).records[0].plan.name === "Edited during save"), "failed server saves preserve local edits and display a retry");
  await find("Retry save").click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.name === "Offline edit");
  await check(Promise.resolve(true), "explicit retry saves after a connection failure");
  const savedId = (await serverSaved()).records[0].summary.id;
  await page.evaluate(id => window.testRemoteEdit(id), savedId);
  await page.getByRole("textbox", { name: "Plan name", exact: true }).fill("My unsaved conflict edit");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).press("Tab");
  await page.locator(".fp-cloud-warning").waitFor();
  await check(Promise.resolve((await page.locator(".fp-cloud-warning").textContent()).includes("newer version")), "stale revisions show a conflict instead of overwriting the saved version");
  await find("My plans").first().click(); await find("Open Remote version for Alex Existing").click();
  await check(Promise.resolve((await saved()).name === "Remote version" && await page.evaluate(k => JSON.parse(localStorage.getItem(k)).plans.some(p => p.name === "My unsaved conflict edit (local copy)"), key)), "opening the server version preserves conflicting edits as a separate local copy");
  await page.goto("http://127.0.0.1:4179?clientId=client-alex&new=1");
  await page.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await saved()).walls.length === 8 && (await serverSaved()).records.length === 1), "older New plan links reopen the existing Before stage without creating duplicates");
  await page.reload(); await page.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await serverSaved()).records.length === 1), "refreshing the Before stage reopens it without creating another plan");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).fill("Latest Before drawing");
  await page.getByRole("textbox", { name: "Plan name", exact: true }).press("Tab");
  await find("Start After plan").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Open After plan"]')?.getAttribute("aria-pressed") === "true");
  cloud = await serverSaved();
  const beforeRecord = cloud.records.find(r => r.summary.stage === "before"), afterRecord = cloud.records.find(r => r.summary.stage === "after");
  await check(Promise.resolve(cloud.records.length === 2 && beforeRecord.plan.name === "Latest Before drawing" && afterRecord.plan.id !== beforeRecord.plan.id && isDeepStrictEqual(afterRecord.plan.walls, beforeRecord.plan.walls) && isDeepStrictEqual(afterRecord.plan.fixtures, beforeRecord.plan.fixtures)), "starting After saves pending Before edits and copies its full drawing into a distinct stage");
  await find("Objects").click(); await find("Place Queen bed").click(); await click(60, 60); await page.keyboard.press("Escape");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records.find(r => r.summary.stage === "after").plan.fixtures.length === 1);
  await find("Open Before plan").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Open Before plan"]')?.getAttribute("aria-pressed") === "true");
  await check(Promise.resolve((await saved()).fixtures.length === 0 && (await saved()).name === "Latest Before drawing"), "After edits leave the Before plan unchanged and stage switching restores Before");
  await find("Open After plan").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Open After plan"]')?.getAttribute("aria-pressed") === "true");
  await check(Promise.resolve((await saved()).fixtures.length === 1 && (await serverSaved()).records.length === 2), "reopening After preserves its edits without copying Before again");
  await page.reload(); await page.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve((await saved()).id === afterRecord.plan.id && (await saved()).fixtures.length === 1), "refreshing After opens the correct stage and preserves its independent edits");
  await page.screenshot({ path: resolve(output, "before-after-editor.png"), fullPage: true });
  const clientPage = await context.newPage();
  await clientPage.goto("http://127.0.0.1:4179?clientView=client-alex");
  await check(Promise.resolve(await clientPage.getByRole("heading", { name: "Before", exact: true }).count() === 1 && await clientPage.getByRole("heading", { name: "After", exact: true }).count() === 1 && await clientPage.getByRole("button", { name: "Delete Before plan" }).isDisabled()), "client page shows one Before and After slot and keeps the pair together");
  await clientPage.getByRole("button", { name: "Open After", exact: true }).click();
  await clientPage.getByRole("application").waitFor();
  await check(Promise.resolve((await clientPage.getByRole("button", { name: "Open After plan" }).getAttribute("aria-pressed")) === "true"), "client page opens the selected After drawing in the editor");
  await clientPage.close();
  const emptyClient = cloud.clients.find(c => c.id !== "client-alex").id;
  const firstPage = await context.newPage();
  await firstPage.goto(`http://127.0.0.1:4179?clientView=${emptyClient}`);
  await check(Promise.resolve(await firstPage.getByRole("button", { name: "Create After from Before" }).isDisabled()), "client page requires drawing Before before creating After");
  await firstPage.getByRole("button", { name: "Draw Before" }).click();
  await firstPage.locator(".fp-client-badge").waitFor();
  await check(Promise.resolve(await firstPage.getByRole("button", { name: "Start After plan" }).isDisabled()), "an empty new Before cannot seed an After plan");
  await firstPage.getByRole("button", { name: "Rectangle", exact: true }).first().click();
  const firstWorld = async (x, y) => firstPage.locator('[data-layer="walls"]').evaluate((el, p) => { const matrix = el.closest("svg").querySelector('g[transform^="translate("]').getScreenCTM(); const point = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: point.x, y: point.y }; }, { x, y });
  for (const [x, y] of [[0, 0], [180, 120]]) { const point = await firstWorld(x, y); await firstPage.mouse.click(point.x, point.y); }
  await firstPage.keyboard.press("Escape");
  await firstPage.evaluate(() => { window.testSaveFailure = "Connection unavailable. Your local draft is kept."; });
  await firstPage.getByRole("button", { name: "Start After plan" }).click();
  await firstPage.locator(".fp-cloud-warning").waitFor();
  await check(Promise.resolve(await firstPage.getByRole("button", { name: "Open Before plan" }).getAttribute("aria-pressed") === "true"), "a failed save keeps Before open and does not create After from stale data");
  await firstPage.getByRole("button", { name: "Start After plan" }).click();
  await firstPage.waitForFunction(() => document.querySelector('[aria-label="Open After plan"]')?.getAttribute("aria-pressed") === "true");
  await check(Promise.resolve(await firstPage.locator('[data-kind="wall"]').count() > 0), "retry saves Before and creates its After copy successfully");
  await firstPage.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await find("Toggle tools panel").click(); await find("Objects").click();
  await page.screenshot({ path: resolve(output, "mobile-catalog.png"), fullPage: true });
  await check(Promise.resolve(await page.locator(".fp-left-panel").isVisible()), "mobile tool drawer opens");
  await find("Toggle tools panel").click();
  await find("Toggle properties panel").click();
  await check(Promise.resolve(await page.locator(".fp-right-panel").isVisible()), "mobile properties drawer opens");
  await find("Toggle properties panel").click();
  await check(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile layout fits viewport without horizontal overflow");
  const quotaPage = await context.newPage();
  await quotaPage.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Storage is full", "QuotaExceededError"); }; });
  await quotaPage.goto("http://127.0.0.1:4179");
  await quotaPage.locator(".fp-storage-warning").waitFor();
  await check(Promise.resolve((await quotaPage.locator(".fp-storage-warning").textContent()).includes("Export a backup")), "storage failures visibly prompt a backup without blocking editing");
  await quotaPage.close();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto("http://127.0.0.1:4179");
  await mobilePage.getByRole("application").waitFor();
  await mobilePage.waitForFunction(() => {
    const drawing = document.querySelector('[data-layer="walls"]')?.getBoundingClientRect();
    const canvas = document.querySelector(".fp-canvas")?.getBoundingClientRect();
    return drawing && canvas && drawing.left >= canvas.left && drawing.right <= canvas.right && drawing.top >= canvas.top && drawing.bottom <= canvas.bottom;
  });
  await mobilePage.screenshot({ path: resolve(output, "mobile-first-load.png"), fullPage: true });
  await check(Promise.resolve(true), "fresh mobile launch fits the entire plan inside the measured viewport");
  for (const viewport of [{ width: 320, height: 844 }, { width: 375, height: 844 }, { width: 540, height: 844 }, { width: 844, height: 390 }]) {
    await mobilePage.setViewportSize(viewport);
    await check(mobilePage.locator(".fp-toolbar").evaluate(toolbar => {
      const box = toolbar.getBoundingClientRect();
      const controls = ["Home", "Select", "Pan", "Save plan", "My plans", "New plan", "Export"];
      return controls.every(name => {
        const b = toolbar.querySelector(`button[aria-label="${name}"]`).getBoundingClientRect();
        return b.width > 0 && b.left >= 0 && b.right <= window.innerWidth && b.top >= box.top && b.bottom <= box.bottom;
      }) && document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight;
    }), `Home and plan actions fit one toolbar across the full ${viewport.width}×${viewport.height} viewport`);
    await mobilePage.getByRole("button", { name: "Fit plan to view", exact: true }).click();
    // Keyboard activation also works when a dimension is densely packed on a small screen.
    const dimensionLabel = mobilePage.locator('[data-edit-dimension]').first();
    await dimensionLabel.focus(); await dimensionLabel.press("Enter");
    await mobilePage.getByRole("textbox", { name: "New dimension", exact: true }).waitFor();
    await check(mobilePage.locator(".fp-dimension-editor").evaluate(el => {
      const b = el.getBoundingClientRect(), canvas = document.querySelector(".fp-canvas").getBoundingClientRect();
      return b.left >= canvas.left && b.right <= canvas.right && b.top >= canvas.top && b.bottom <= canvas.bottom && !document.querySelector('[role="dialog"]');
    }), `inline dimension editor stays inside the drawing at ${viewport.width}×${viewport.height}`);
    await mobilePage.getByRole("textbox", { name: "New dimension", exact: true }).fill("invalid");
    await mobilePage.getByRole("textbox", { name: "New dimension", exact: true }).press("Enter");
    await check(mobilePage.locator(".fp-dimension-editor").evaluate(el => {
      const b = el.getBoundingClientRect(), canvas = document.querySelector(".fp-canvas").getBoundingClientRect();
      return !!el.querySelector('[role="alert"]') && b.left >= canvas.left && b.right <= canvas.right && b.top >= canvas.top && b.bottom <= canvas.bottom;
    }), `inline errors remain visible inside the drawing at ${viewport.width}×${viewport.height}`);
    if (viewport.width === 320) await mobilePage.screenshot({ path: resolve(output, "mobile-inline-dimension.png"), fullPage: true });
    await mobilePage.getByRole("textbox", { name: "New dimension", exact: true }).press("Escape");
  }
  await mobilePage.getByRole("button", { name: "Home", exact: true }).click();
  await mobilePage.getByRole("dialog", { name: "Exit floor plan editor?" }).waitFor();
  await mobilePage.getByRole("button", { name: "Stay in editor", exact: true }).click();
  await check(Promise.resolve(await mobilePage.getByRole("application").isVisible()), "mobile Home requires confirmation and Stay retains the editor");
  await mobileContext.close();
  const exitContext = await browser.newContext({ viewport: { width: 1560, height: 1040 } });
  const exitPage = await exitContext.newPage();
  const exitButton = name => exitPage.getByRole("button", { name, exact: true });
  await exitPage.goto("http://127.0.0.1:4179");
  await exitPage.getByRole("application").waitFor();
  await exitButton("Home").click();
  await exitPage.getByRole("dialog", { name: "Exit floor plan editor?" }).waitFor();
  await exitPage.screenshot({ path: resolve(output, "exit-confirmation.png"), fullPage: true });
  await exitButton("Stay in editor").click();
  await check(Promise.resolve(await exitPage.getByRole("application").isVisible() && exitPage.url().endsWith("/")), "canceling Home does not navigate or change the drawing");
  await exitButton("Home").click(); await exitPage.keyboard.press("Escape");
  await check(Promise.resolve(await exitPage.getByRole("dialog").count() === 0 && await exitPage.getByRole("application").isVisible()), "Escape cancels the exit confirmation");
  await exitPage.getByRole("textbox", { name: "Plan name", exact: true }).fill("Latest local draft before exit");
  await exitButton("Home").click(); await exitButton("Exit to home").click();
  await exitPage.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  await check(exitPage.evaluate(k => JSON.parse(localStorage.getItem(k)).plans[0].name === "Latest local draft before exit", key), "confirmed exit navigates home and immediately flushes the newest draft");
  await exitPage.goto("http://127.0.0.1:4179"); await exitPage.getByRole("application").waitFor();
  await exitButton("Save plan").click(); await exitButton("Create new client").click();
  await exitPage.getByRole("textbox", { name: "Client name", exact: true }).fill("Exit save client");
  await exitButton("Create client & save plan").click(); await exitPage.locator(".fp-client-badge").waitFor();
  await exitPage.evaluate(() => { window.testSaveDelay = 600; });
  await exitPage.getByRole("textbox", { name: "Plan name", exact: true }).fill("Canceled exit save");
  await exitButton("Home").click(); await exitButton("Exit to home").click(); await exitButton("Stay in editor").click();
  await exitPage.waitForFunction(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.name === "Canceled exit save");
  await check(Promise.resolve(await exitPage.getByRole("application").isVisible() && await exitPage.getByRole("heading", { name: "Dashboard", exact: true }).count() === 0), "canceling during an exit save prevents later navigation");
  await exitPage.evaluate(() => { window.testSaveDelay = 150; window.testSaveFailure = "Connection unavailable"; });
  await exitPage.getByRole("textbox", { name: "Plan name", exact: true }).fill("Latest client edit before exit");
  await exitButton("Home").click(); await exitButton("Exit to home").click();
  await exitPage.getByRole("dialog").getByRole("alert").waitFor();
  await check(Promise.resolve(await exitPage.getByRole("application").isVisible() && (await exitPage.getByRole("dialog").textContent()).includes("latest draft is saved")), "failed exit saves keep the editor open and preserve a local recovery draft");
  await exitButton("Exit to home").click();
  await exitPage.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  await check(exitPage.evaluate(() => JSON.parse(localStorage.getItem("sah-helper:floor-plan-test-server")).records[0].plan.name === "Latest client edit before exit"), "confirmed exit waits for the latest client changes to save before navigating");
  await exitContext.close();
  await check(Promise.resolve(errors.length === 0), `no browser errors: ${errors.join(" | ")}`);
  console.log(`Screenshots and exported artifacts: ${output}`);
} finally {
  await browser?.close(); await server.close();
}
