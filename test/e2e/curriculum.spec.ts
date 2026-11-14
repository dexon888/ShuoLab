import { expect, test, type Page } from "@playwright/test";

// Runs against a database seeded with SYNTHETIC placeholder vocabulary
// (scripts/prepare-e2e.mjs). The entries are generated, not HSK content.

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

test.describe("browsing the curriculum (FR-016)", () => {
  test("overview to band to entry and back, with test data labelled throughout", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/curriculum");
    await expect(page.getByText("Test data loaded, not HSK content")).toBeVisible();

    await page.getByRole("link", { name: "HSK 2", exact: true }).click();
    await expect(page).toHaveURL(/\/curriculum\/2$/);
    await expect(page.getByText("200 entries, showing 50.")).toBeVisible();
    await expect(page.getByText("Test data, not HSK content.")).toBeVisible();
    await expectNoSidewaysScroll(page, "band page");

    const entries = page.getByRole("main").getByRole("link", { name: /样例/ });
    await expect(entries).toHaveCount(50);
    await entries.first().click();

    await expect(page).toHaveURL(/\/curriculum\/item\/synthetic-fixture(%3A|:)vocab(%3A|:)301$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "zh-Hans");
    await expect(page.getByText("Test data, not HSK content.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Meaning" })).toContainText("No definition.");
    await expect(page.getByRole("region", { name: "Source" })).toContainText("synthetic-fixture");
    await expectNoSidewaysScroll(page, "entry page");

    await page.getByRole("main").getByRole("link", { name: "HSK 2", exact: true }).click();
    await expect(page).toHaveURL(/\/curriculum\/2$/);
    expect(errors).toEqual([]);
  });

  test("shows more entries on request until the band is complete", async ({ page }) => {
    await page.goto("/curriculum/2");
    const entries = page.getByRole("main").getByRole("link", { name: /样例/ });
    await expect(entries).toHaveCount(50);

    const more = page.getByRole("button", { name: "Show more entries" });
    for (const shown of [100, 150, 200]) {
      await more.click();
      await expect(entries).toHaveCount(shown);
    }
    await expect(page.getByText("200 entries, showing 200.")).toBeVisible();
    await expect(more).toHaveCount(0);
  });

  test("filters with the keyboard and keeps the filter in the address", async ({ page }) => {
    await page.goto("/curriculum/1");
    await expect(page.getByText("300 entries, showing 50.")).toBeVisible();

    const search = page.getByLabel("Characters or pinyin");
    await search.fill("样例同形");
    await search.press("Enter");

    await expect(page.getByText("2 entries match, showing 2.")).toBeVisible();
    await expect(page).toHaveURL(/[?&]q=/);

    // The filter survives a reload.
    await page.reload();
    await expect(page.getByText("2 entries match, showing 2.")).toBeVisible();
    await expect(page.getByLabel("Characters or pinyin")).toHaveValue("样例同形");

    // The two entries share a written form and link to each other.
    await page.getByRole("main").getByRole("link", { name: /样例同形/ }).first().click();
    const same = page.getByRole("region", { name: "Same written form" });
    await expect(same.getByRole("link")).toHaveCount(1);
    await same.getByRole("link").click();
    await expect(page.getByRole("region", { name: "Same written form" }).getByRole("link")).toHaveCount(1);
  });

  test("filters by part of speech and clears the filter", async ({ page }) => {
    await page.goto("/curriculum/1");
    const select = page.getByLabel("Part of speech");
    await expect(select.locator("option")).not.toHaveCount(1);
    const tag = await select.locator("option").nth(1).getAttribute("value");
    expect(tag).toBeTruthy();

    await select.selectOption(tag as string);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText(/ match(es)?, showing /)).toBeVisible();
    await expect(page.getByText("300 entries, showing 50.")).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]pos=/);

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByText("300 entries, showing 50.")).toBeVisible();
    await expect(page).toHaveURL(/\/curriculum\/1$/);
  });

  test("a search with no matches says so", async ({ page }) => {
    await page.goto("/curriculum/3?q=zzzz");
    await expect(page.getByText("No entries match these filters.")).toBeVisible();
  });

  test("an entry that was never imported shows an error, not a blank page", async ({ page }) => {
    await page.goto("/curriculum/item/synthetic-fixture:vocab:99999");
    await expect(page.getByRole("alert")).toContainText("Couldn't load this entry");
  });

  test("filter controls and entry rows are large enough to tap", async ({ page }) => {
    await page.goto("/curriculum/1");
    const targets = [
      page.getByLabel("Characters or pinyin"),
      page.getByLabel("Part of speech"),
      page.getByRole("button", { name: "Filter" }),
      page.getByRole("main").getByRole("link", { name: /样例/ }).first(),
      page.getByRole("button", { name: "Show more entries" }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("the entries API never returns the whole vocabulary at once", async ({ request }) => {
    const res = await request.get("/api/v1/curriculum/items");
    const body = await res.json();
    expect(body.total).toBe(11000);
    expect(body.items).toHaveLength(50);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect((await request.get("/api/v1/curriculum/items?limit=5000")).status()).toBe(400);
  });
});
