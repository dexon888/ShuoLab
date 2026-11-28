import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Automated accessibility pass (SPEC §10). axe covers contrast, names, labels,
// landmarks and ARIA use against WCAG 2.1 A and AA. It cannot judge everything,
// so keyboard reach and visible focus are checked separately below.
const PAGES: [string, RegExp][] = [
  ["/", /Today/],
  ["/onboarding", /Getting started/],
  ["/curriculum", /Curriculum/],
  ["/curriculum/1", /HSK 1/],
  ["/curriculum/colloquial", /Colloquial expressions/],
  ["/review", /Review/],
  ["/progress", /Progress/],
  ["/tests", /Tests/],
  ["/start", /Start here/],
  ["/stories", /Stories/],
  ["/start/tones", /The four tones/],
  ["/settings", /Settings/],
  ["/no-such-page", /Page not found/],
];

async function scan(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const problems = result.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join("\n  ")}`,
  );
  expect(problems, `accessibility problems on ${label}`).toEqual([]);
}

test.describe("accessibility (SPEC §10)", () => {
  for (const [path, heading] of PAGES) {
    test(`${path} has no WCAG A/AA problems axe can detect`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await scan(page, path);
    });
  }

  test("an entry page has no WCAG A/AA problems axe can detect", async ({ page }) => {
    await page.goto("/curriculum/1");
    await page.locator('a[href^="/curriculum/item/"]').first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await scan(page, "an entry page");
  });

  test("the keyboard reaches the main navigation, and focus is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const visible = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        return { name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), visible };
      });
      if (!focus) continue;
      expect(focus.visible, `no visible focus on "${focus.name}"`).toBe(true);
      seen.push(focus.name);
    }
    for (const name of ["Today", "Review", "Progress", "Settings"]) {
      expect(seen.some((s) => s.includes(name)), `${name} is not reachable by keyboard`).toBe(true);
    }
  });

  test("reduced motion turns off animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Today/ })).toBeVisible();
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
        const s = getComputedStyle(el);
        const dur = (v: string) => Math.max(...v.split(",").map((x) => parseFloat(x) || 0));
        return (s.animationName !== "none" && dur(s.animationDuration) > 0.01) || dur(s.transitionDuration) > 0.01;
      }).length,
    );
    expect(moving).toBe(0);
  });
});
