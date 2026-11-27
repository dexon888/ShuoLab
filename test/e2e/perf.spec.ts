import { expect, test } from "@playwright/test";

// PERF-01 (SPEC §12): a cached dashboard paints in about 2 seconds, and
// non-model API reads answer within about 500 ms at the 95th percentile.
// Measured against the production build on the local Worker runtime with the
// 11,000-entry placeholder vocabulary, so network time is excluded. The
// numbers are written to the test output; the limits fail the build if broken.

const READS = [
  "/api/v1/me",
  "/api/v1/curriculum/status",
  "/api/v1/curriculum/items?band=1",
  "/api/v1/curriculum/items?band=7-9&q=%E6%A0%B7",
  "/api/v1/sessions?limit=5",
  "/api/v1/reviews/due?limit=20",
  "/api/v1/progress/summary?days=90",
  "/api/v1/usage/monthly",
];
const SAMPLES = 20;

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

test.describe("speed (PERF-01)", () => {
  test.describe.configure({ mode: "serial" });

  test("non-model API reads answer within 500 ms at the 95th percentile", async ({ request }, info) => {
    test.skip(info.project.name !== "seeded-desktop", "measured once");
    const lines: string[] = [];
    for (const path of READS) {
      await request.get(path); // warm
      const times: number[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const t0 = performance.now();
        const res = await request.get(path);
        times.push(performance.now() - t0);
        expect(res.ok(), path).toBe(true);
      }
      const value = Math.round(p95(times));
      lines.push(`${path}: p95 ${value} ms over ${SAMPLES}`);
      expect(value, `${path} p95`).toBeLessThan(500);
    }
    info.annotations.push({ type: "api-p95", description: lines.join("; ") });
    console.log(`PERF-01 API reads\n${lines.join("\n")}`);
  });

  test("the dashboard paints within 2 seconds once cached", async ({ page }, info) => {
    test.skip(info.project.name !== "seeded-mobile-320", "measured at phone width");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
    // Second visit: the service worker and HTTP cache hold the app shell.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1);
    const ready = await page.evaluate(() => performance.now());
    console.log(`PERF-01 dashboard: first contentful paint ${Math.round(fcp)} ms, heading visible by ${Math.round(ready)} ms`);
    info.annotations.push({ type: "dashboard", description: `FCP ${Math.round(fcp)} ms; heading by ${Math.round(ready)} ms` });
    expect(fcp).toBeGreaterThan(0);
    expect(fcp).toBeLessThan(2000);
    expect(ready).toBeLessThan(3000);
  });
});
