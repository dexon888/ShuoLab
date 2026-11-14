import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any uncaught exception or console error (FR-001). */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test.describe("first launch (FR-001, FR-005)", () => {
  test("dashboard loads from the real Worker and reports that nothing is imported", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
    await expect(page.getByText("Curriculum not imported")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start today's session" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByText("Practice stand-in")).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("the page never scrolls sideways", async ({ page }) => {
    for (const path of ["/", "/curriculum", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test("every route shell renders without errors", async ({ page }) => {
    const errors = trackErrors(page);
    const routes: [string, RegExp][] = [
      ["/onboarding", /Getting started/],
      ["/session/example", /Session/],
      ["/curriculum", /Curriculum/],
      ["/curriculum/1", /HSK 1/],
      ["/curriculum/7-9", /HSK 7–9/],
      ["/curriculum/8", /Page not found/],
      ["/curriculum/colloquial", /Colloquial expressions/],
      ["/curriculum/item/example", /Page not found/],
      ["/review", /Review/],
      ["/progress", /Progress/],
      ["/settings", /Settings/],
      ["/no-such-page", /Page not found/],
    ];
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("a band with nothing imported says so and points to the import steps", async ({ page }) => {
    await page.goto("/curriculum/1");
    await expect(page.getByText("No entries are imported for this band.")).toBeVisible();
    await page.getByRole("link", { name: /how to import the vocabulary/ }).click();
    await expect(page).toHaveURL(/\/curriculum$/);
  });
});

test("the colloquial track says nothing is imported and how to add it", async ({ page }) => {
  await page.goto("/curriculum/colloquial");
  await expect(page.getByText("No colloquial expressions imported")).toBeVisible();
  await expect(page.getByText("Not part of the HSK syllabus.")).toBeVisible();
});

test.describe("navigation and accessibility", () => {
  test("main navigation works with the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

    const curriculum = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Curriculum/ });
    await curriculum.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/curriculum$/);
    await expect(curriculum).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "HSK 7–9 (shared band)" })).toBeVisible();
  });

  test("navigation targets are large enough to tap", async ({ page }) => {
    await page.goto("/");
    const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(links).toHaveCount(5);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("installable PWA (FR-001)", () => {
  test("serves a valid manifest with icons that exist", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");

    const manifest = await (await request.get(href as string)).json();
    expect(manifest).toMatchObject({ name: "ShuoLab", display: "standalone", start_url: "/" });
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const res = await request.get(icon.src);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });

  test("registers a service worker in the production build", async ({ page }) => {
    await page.goto("/");
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return new URL(registration.scope).pathname;
    });
    expect(scope).toBe("/");
  });
});

test.describe("API and security headers", () => {
  test("health is public and exposes nothing but status", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.status()).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["ready", "version"]);
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("unknown API routes return a JSON error, not the app shell", async ({ request }) => {
    const res = await request.get("/api/v1/nope");
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  test("the app shell is served with a Content-Security-Policy", async ({ request }) => {
    const res = await request.get("/");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("openai");
  });

  test("the client bundle contains no provider secret names or bypass flag", async ({ page, request }) => {
    await page.goto("/");
    const sources = await page.locator("script[src]").evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLScriptElement).src),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      const text = await (await request.get(src)).text();
      for (const forbidden of ["OPENAI_API_KEY", "AZURE_SPEECH_KEY", "DEV_AUTH_BYPASS"]) {
        expect(text, `${forbidden} in ${src}`).not.toContain(forbidden);
      }
    }
  });
});
