import { expect, test, type Page } from "@playwright/test";

// Runs against a database with no curriculum. The desktop and 320px projects
// share it, and a day has one plan, so the second project to arrive finds the
// open conversation already planned.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test.describe("sessions without the curriculum (FR-005)", () => {
  test("HSK sessions are blocked and an open conversation is planned and labelled as such", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Start today's session" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/need the real HSK vocabulary, which has not been imported yet/)).toBeVisible();

    const plan = page.getByRole("button", { name: "Plan an open conversation instead" });
    const open = page.getByRole("link", { name: /Open today's plan|Resume today's session/ });
    await plan.or(open).first().click();
    await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/);

    await expect(page.getByText("Open conversation, not an HSK lesson.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Words for this session" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Session steps" }).getByRole("button")).toHaveCount(9);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal overflow on the plan page").toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("the API refuses an HSK plan and unknown or malformed sessions", async ({ request }) => {
    const refused = await request.post("/api/v1/sessions/plan", { data: {} });
    expect(refused.status()).toBe(503);
    expect((await refused.json()).error.code).toBe("CURRICULUM_MISSING");

    expect((await request.get("/api/v1/sessions/not-a-session")).status()).toBe(400);
    expect((await request.get("/api/v1/sessions/11111111-2222-4333-8444-555555555555")).status()).toBe(404);
    expect((await request.post("/api/v1/sessions/plan", { data: { durationMinutes: 45 } })).status()).toBe(400);
  });
});
