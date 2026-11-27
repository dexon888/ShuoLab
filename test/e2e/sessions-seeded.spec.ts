import { expect, test, type Page } from "@playwright/test";

// Runs against a database seeded with SYNTHETIC placeholder vocabulary
// (scripts/prepare-e2e.mjs). The desktop and 320px projects share that
// database, and a day has one plan, so whichever project gets there second
// finds the plan already made. Both paths are valid here.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openTodaysPlan(page: Page) {
  await page.goto("/");
  const start = page.getByRole("button", { name: "Start today's session" });
  const open = page.getByRole("link", { name: /Open today's plan|Resume today's session/ });
  await start.or(open).first().click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/);
  await showWords(page);
}

/** Once a session has started, its words fold away under the steps; open them. */
async function showWords(page: Page) {
  await expect(page.getByRole("navigation", { name: "Session steps" })).toBeVisible();
  const folded = page.getByText("Today's words, grammar and characters");
  if (await folded.isVisible()) {
    const open = await page.locator("details", { has: folded }).evaluate((d) => (d as HTMLDetailsElement).open);
    if (!open) await folded.click();
  }
}

test.describe("planning today's session (SPEC §5.2, §5.3, FR-005, FR-006)", () => {
  test("Today leads to a saved plan with words, a goal and a time budget", async ({ page }) => {
    const errors = trackErrors(page);
    await openTodaysPlan(page);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("This situation was written for ShuoLab. It is not an HSK topic or task.")).toBeVisible();
    await expect(page.getByText("Test data, not HSK content.")).toBeVisible();

    const words = page.getByRole("region", { name: "Words for this session" });
    const count = await words.getByRole("link").count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(8);
    await expect(words).toContainText("It is not a measured level.");

    // The session runs as a fixed sequence of steps (SPEC §5.3).
    const steps = page.getByRole("navigation", { name: "Session steps" });
    await expect(steps.getByRole("button")).toHaveCount(8);
    await expect(steps).toContainText(/\d+% of the time is listening and speaking\./);
    await steps.getByRole("button", { name: /Conversation/ }).click();
    await expect(page.getByRole("region", { name: "Conversation" }).getByLabel("Your reply in Chinese")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow on the plan page").toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("the plan survives a reload and Today offers it again instead of a second plan", async ({ page }) => {
    await openTodaysPlan(page);
    const url = page.url();
    const words = page.getByRole("region", { name: "Words for this session" });
    await expect(words.getByRole("link").first()).toBeVisible();
    const before = await words.getByRole("link").allInnerTexts();

    await page.reload();
    await showWords(page);
    await expect(words.getByRole("link").first()).toBeVisible();
    expect(await words.getByRole("link").allInnerTexts()).toEqual(before);

    await page.getByRole("link", { name: "Today", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Start today's session" })).toHaveCount(0);
    await page.getByRole("link", { name: /Open today's plan|Resume today's session/ }).click();
    await expect(page).toHaveURL(url);
  });

  test("a word in the plan opens its curriculum entry", async ({ page }) => {
    await openTodaysPlan(page);
    await page.getByRole("region", { name: "Words for this session" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/curriculum\/item\//);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
