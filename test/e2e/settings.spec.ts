import { expect, test, type Page } from "@playwright/test";

// The desktop and 320px projects share one database, so every test here
// writes the same values and none depends on what another test left behind.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow on ${where}`).toBeLessThanOrEqual(0);
}

test.describe("settings persist across devices (SPEC §5.1, FR-020)", () => {
  test("saved preferences appear in a different browser session", async ({ page, browser, baseURL }) => {
    const errors = trackErrors(page);
    await page.goto("/settings");

    await page.getByLabel("Nickname (optional)").fill("小丁");
    await page.getByRole("radio", { name: "30 minutes" }).check();
    await page.getByLabel("Reading help").selectOption("hanzi");
    await page.getByLabel("HSK band to study").selectOption("2");
    await page.getByLabel("Time zone").selectOption("Asia/Shanghai");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/Saved\. These settings apply on every device/)).toBeVisible();

    // A second device: a fresh browser context with no shared storage.
    const other = await browser.newContext({ baseURL });
    const otherPage = await other.newPage();
    await otherPage.goto("/settings");
    await expect(otherPage.getByLabel("Nickname (optional)")).toHaveValue("小丁");
    await expect(otherPage.getByRole("radio", { name: "30 minutes" })).toBeChecked();
    await expect(otherPage.getByLabel("Reading help")).toHaveValue("hanzi");
    await expect(otherPage.getByLabel("HSK band to study")).toHaveValue("2");
    await expect(otherPage.getByLabel("Time zone")).toHaveValue("Asia/Shanghai");
    await other.close();

    // And after a reload on the first device.
    await page.reload();
    await expect(page.getByLabel("Nickname (optional)")).toHaveValue("小丁");
    expect(errors).toEqual([]);
  });

  test("onboarding saves and returns to Today", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByText(/A study target you choose, not a proven level/)).toBeVisible();
    await page.getByLabel("Nickname (optional)").fill("小丁");
    await page.getByRole("radio", { name: "30 minutes" }).check();
    await page.getByLabel("Reading help").selectOption("hanzi");
    await page.getByLabel("HSK band to study").selectOption("2");
    await page.getByLabel("Time zone").selectOption("Asia/Shanghai");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
    await expect(page.getByText("Set up your preferences.")).toHaveCount(0);
  });

  test("the forms fit a narrow screen and their controls are large enough to tap", async ({ page }) => {
    for (const path of ["/onboarding", "/settings"]) {
      await page.goto(path);
      await expect(page.getByLabel("Nickname (optional)")).toBeVisible();
      await expectNoSidewaysScroll(page, path);
      const controls = [
        page.getByLabel("Nickname (optional)"),
        page.getByLabel("HSK band to study"),
        page.getByLabel("Speech rate"),
        page.getByLabel("Time zone"),
        page.getByRole("button", { name: /^Save/ }),
      ];
      for (const control of controls) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0, `${path} control height`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("the speech rate can be set with the keyboard", async ({ page }) => {
    await page.goto("/settings");
    const slider = page.getByLabel("Speech rate");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveValue("0.75");
    await expect(page.getByText("0.75×")).toBeVisible();
    await page.keyboard.press("End");
    await expect(slider).toHaveValue("1.15");
  });
});

test.describe("settings API", () => {
  test("rejects fields that are not settings and values out of range", async ({ request }) => {
    for (const data of [{ isAdmin: true }, { sessionMinutes: 45 }, { studyBand: "8" }, {}]) {
      const res = await request.put("/api/v1/settings", { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
      expect((await res.json()).error.code).toBe("BAD_REQUEST");
    }
  });

  test("refuses a write that claims to come from another site", async ({ request }) => {
    const res = await request.put("/api/v1/settings", {
      data: { sessionMinutes: 30 },
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
  });

  test("settings responses are never cached", async ({ request }) => {
    const res = await request.get("/api/v1/settings");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
  });
});

test.describe("spending this month (SPEC §4.3)", () => {
  test("Settings shows the estimate and says it is not a bill", async ({ page }) => {
    await page.goto("/settings");
    const region = page.getByRole("region", { name: "Spending this month" });
    await expect(region).toContainText(/US\$\d+\.\d+ estimated in \d{4}-\d{2} \(UTC\)/);
    await expect(region).toContainText("Your provider's bill may differ");
    await expectNoSidewaysScroll(page, "/settings");
  });

  test("the usage API reports the month, the amounts and a disclaimer", async ({ request }) => {
    const res = await request.get("/api/v1/usage/monthly");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const usage = await res.json();
    expect(usage.month).toMatch(/^\d{4}-\d{2}$/);
    expect(usage.estimatedUsd).toBeGreaterThanOrEqual(0);
    expect(usage.disclaimer).toContain("bill may differ");
  });
});
