import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backend = createRequire(resolve(repo, "packages/backend/package.json"));
const web = createRequire(resolve(repo, "apps/web/package.json"));
const { createServer } = await import(pathToFileURL(backend.resolve("vite")).href);
const server = await createServer({ configFile: false, root: resolve(repo, "tests/field-harness"),
  css: { postcss: { plugins: [(await import(pathToFileURL(web.resolve("@tailwindcss/postcss")).href)).default()] } },
  resolve: { alias: [
    { find: "convex/react", replacement: resolve(repo, "tests/field-harness/service.tsx") },
    { find: "convex/server", replacement: backend.resolve("convex/server") },
    { find: "sonner", replacement: web.resolve("sonner") },
    { find: "next/navigation", replacement: resolve(repo, "tests/field-harness/navigation.ts") },
    { find: "next/link", replacement: resolve(repo, "tests/floor-plan-harness/link.tsx") },
    { find: "@", replacement: resolve(repo, "apps/web/src") },
    { find: /^react$/, replacement: web.resolve("react") },
    { find: /^react\/(.*)/, replacement: resolve(repo, "apps/web/node_modules/react/$1") },
    { find: /^react-dom\/(.*)/, replacement: resolve(repo, "apps/web/node_modules/react-dom/$1") },
  ] }, server: { host: "127.0.0.1", port: 4181, strictPort: true, fs: { allow: [repo] } },
});
await server.listen();
console.log("Isolated Field GC UI test: http://127.0.0.1:4181 (no production accounts or data)");
