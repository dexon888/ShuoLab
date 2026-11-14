import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const SEEDED_PORT = 4174;
const SEEDED_SPECS = /(curriculum|sessions-seeded)\.spec\.ts$/;

const desktop = { ...devices["Desktop Chrome"] };
const mobile = { ...devices["Desktop Chrome"], viewport: { width: 320, height: 640 }, hasTouch: true };

// E2E runs against the production build served by `vite preview`, so the
// service worker and the real Worker runtime (workerd + local D1) are exercised.
// `pnpm test:e2e` first runs scripts/prepare-e2e.mjs, which builds the app and
// creates the two databases the servers below use.
function previewServer(port: number, stateDir: string) {
  return {
    command: `pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/api/v1/health`,
    env: { SHUOLAB_STATE_DIR: stateDir },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  };
}

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "on-first-retry" },
  projects: [
    // Nothing imported.
    { name: "desktop", testIgnore: SEEDED_SPECS, use: { ...desktop, baseURL: `http://localhost:${PORT}` } },
    { name: "mobile-320", testIgnore: SEEDED_SPECS, use: { ...mobile, baseURL: `http://localhost:${PORT}` } },
    // Synthetic placeholder vocabulary loaded.
    { name: "seeded-desktop", testMatch: SEEDED_SPECS, use: { ...desktop, baseURL: `http://localhost:${SEEDED_PORT}` } },
    { name: "seeded-mobile-320", testMatch: SEEDED_SPECS, use: { ...mobile, baseURL: `http://localhost:${SEEDED_PORT}` } },
  ],
  webServer: [
    previewServer(PORT, ".wrangler/e2e-state"),
    previewServer(SEEDED_PORT, ".wrangler/e2e-seeded"),
  ],
});
