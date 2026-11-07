import { defineConfig } from "@playwright/test";

/**
 * UI end-to-end tests against the real API + web app and the seeded database.
 * Prerequisite: `pnpm seed`. Run with `pnpm test:ui`.
 */
export default defineConfig({
  testDir: "tests/ui",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", viewport: { width: 1440, height: 900 }, colorScheme: "dark", screenshot: "only-on-failure" },
  outputDir: ".data/playwright",
  webServer: [
    { command: "pnpm --filter @rel/api start", url: "http://localhost:4000/api/health", reuseExistingServer: true, timeout: 120_000 },
    { command: "pnpm --filter @rel/web dev -- --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true, timeout: 120_000 },
  ],
});
