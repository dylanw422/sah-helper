import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    env: {
      SITE_URL: "http://localhost:3001",
      CONVEX_SITE_URL: "https://test.convex.site",
      BETTER_AUTH_SECRET: "test-only-secret-at-least-thirty-two-characters",
    },
    server: { deps: { inline: ["@convex-dev/better-auth"] } },
  },
});
