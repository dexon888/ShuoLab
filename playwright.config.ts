import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// E2E runs against the production build served by `vite preview`, so the
// service worker and the real Worker runtime (workerd + local D1) are exercised.
export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-320",
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 640 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
