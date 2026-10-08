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
  const history = async redo => { await page.getByRole("application").focus(); await page.keyboard.press(redo ? "ControlOrMeta+Shift+z" : "ControlOrMeta+z"); };
  const check = async (condition, description) => { assert(await condition, description); console.log(`PASS ${description}`); };
  const wait = () => page.waitForTimeout(550);
  const interiorLabelsCentered = input => {
    const elements = typeof input === "string" ? [...new DOMParser().parseFromString(input, "image/svg+xml").querySelectorAll("[data-room-dimension]")] : input;
    return elements.every(el => {
      const text = el.querySelector("text");
      if (!text) return true;
      const line = el.querySelector("path").getAttribute("d").match(/[ML][^ML]+/g).slice(-2).map(command => command.slice(1).split(",").map(Number));
      const center = text.parentElement.getAttribute("transform").match(/translate\(([^)]+)\)/)[1].split(" ").map(Number);
      return text.getAttribute("y") === "0" && text.getAttribute("dominant-baseline") === "central" && text.parentElement.getAttribute("text-anchor") === "middle"
        && Math.abs(center[0] - (line[0][0] + line[1][0]) / 2) < 1e-8 && Math.abs(center[1] - (line[0][1] + line[1][1]) / 2) < 1e-8;
    });
  };
  const interiorArtwork = () => page.locator('[data-room-dimension]').evaluateAll(elements => elements.map(el => el.outerHTML));
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
  await check(Promise.resolve(await page.locator('[data-layer="rooms"] polygon').count() === 4), "four rooms generated automatically");
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
  await click(90, 240);
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
