import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ColloquialExpression, ColloquialResponse, ColloquialSourceStatus, MeResponse } from "../../src/shared/api";
import { json, renderApp, savedSettings } from "./render";

const me: MeResponse = {
  owner: { email: null, authMode: "dev-bypass" },
  settings: savedSettings(),
  providers: [],
  curriculumImported: false,
  version: "test",
};

function expression(n: number, over: Partial<ColloquialExpression> = {}): ColloquialExpression {
  return {
    id: `colloquial:synthetic-fixture:sample-${n}`,
    sourceKey: "synthetic-fixture",
    term: `样例口语${n}`,
    pinyin: `yànglì kǒuyǔ ${n}`,
    meaningEn: `placeholder meaning ${n}`,
    literalEn: `placeholder literal ${n}`,
    category: "social",
    register: "neutral",
    channel: "both",
    region: null,
    currencyStatus: "steady",
    inUseSince: "2020",
    lastVerifiedAt: "2026-09",
    sourceUrl: `https://example.test/colloquial/sample-${n}`,
    verificationStatus: "verified",
    ...over,
  };
}

const syntheticSource: ColloquialSourceStatus = {
  key: "synthetic-fixture",
  name: "ShuoLab synthetic test fixture",
  homepage: null,
  license: "Not applicable",
  licenseUrl: null,
  attribution: "Generated placeholder rows. Not real expressions.",
  synthetic: true,
  count: 12,
  datasetVersion: "synthetic",
  importedAt: "2026-01-02T03:04:05.000Z",
};

const realSource: ColloquialSourceStatus = {
  key: "hearmandarin",
  name: "HearMandarin",
  homepage: "https://hearmandarin.com",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "HearMandarin (https://hearmandarin.com)",
  synthetic: false,
  count: 185,
  datasetVersion: "2026-09-09",
  importedAt: "2026-01-02T03:04:05.000Z",
};

function page(items: ColloquialExpression[], over: Partial<ColloquialResponse> = {}): ColloquialResponse {
  return { items, total: items.length, nextCursor: null, sources: [syntheticSource], ...over };
}

const URL_BASE = "/api/v1/colloquial";
const meRoute = { "/api/v1/me": () => json(me) };

describe("colloquial page (FR-017)", () => {
  it("says the track is separate from HSK and explains how to import it when empty", async () => {
    renderApp("/curriculum/colloquial", { ...meRoute, [URL_BASE]: () => json(page([], { sources: [] })) });

    expect(await screen.findByText("No colloquial expressions imported")).toBeInTheDocument();
    expect(screen.getByText("Not part of the HSK syllabus.")).toBeInTheDocument();
    expect(screen.getByText(/pnpm colloquial:import/)).toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Colloquial expressions");
  });

  it("shows register, channel and currency for each expression, with warnings where needed", async () => {
    renderApp("/curriculum/colloquial", {
      ...meRoute,
      [URL_BASE]: () =>
        json(page([expression(1), expression(2, { register: "very_informal", channel: "typed", currencyStatus: "fading" })])),
    });

    const plain = (await screen.findByText("样例口语1")).closest("li") as HTMLElement;
    expect(within(plain).getByText("样例口语1")).toHaveAttribute("lang", "zh-Hans");
    expect(plain).toHaveTextContent("placeholder meaning 1");
    expect(plain).toHaveTextContent("Literally: placeholder literal 1");
    const plainTags = within(plain).getByRole("list", { name: "Register and context" });
    expect(plainTags).toHaveTextContent("Fine with anyone");
    expect(plainTags).toHaveTextContent("Spoken and typed");
    expect(within(plain).queryByRole("list", { name: "Usage warnings" })).not.toBeInTheDocument();
    expect(plain).toHaveTextContent("In use since 2020.");
    expect(plain).toHaveTextContent("Checked by the source 2026-09.");
    expect(within(plain).getByRole("link", { name: "Source entry" })).toHaveAttribute(
      "href",
      "https://example.test/colloquial/sample-1",
    );

    const risky = screen.getByText("样例口语2").closest("li") as HTMLElement;
    const warnings = within(risky).getByRole("list", { name: "Usage warnings" });
    expect(within(warnings).getAllByRole("listitem")).toHaveLength(3);
    expect(warnings).toHaveTextContent("swear or insult");
    expect(warnings).toHaveTextContent("Typed only");
    expect(warnings).toHaveTextContent("Fading");
  });

  it("labels synthetic rows as test data and never shows an HSK level", async () => {
    renderApp("/curriculum/colloquial", { ...meRoute, [URL_BASE]: () => json(page([expression(1)])) });
    expect(await screen.findByText("Test data, not real expressions.")).toBeInTheDocument();
    expect(screen.getByRole("main").textContent).not.toMatch(/HSK \d/);
  });

  it("credits a real source with its licence and says examples and audio are not copied", async () => {
    renderApp("/curriculum/colloquial", {
      ...meRoute,
      [URL_BASE]: () => json(page([expression(1, { sourceKey: "hearmandarin" })], { sources: [realSource] })),
    });
    const credit = await screen.findByRole("region", { name: "Source and credit" });
    expect(credit).toHaveTextContent("HearMandarin, 185 expressions, dataset version 2026-09-09, imported 2026-01-02.");
    expect(credit).toHaveTextContent("Credit: HearMandarin (https://hearmandarin.com).");
    expect(within(credit).getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(credit).toHaveTextContent("Example sentences and audio stay on the source's site");
    expect(screen.queryByText(/Test data/)).not.toBeInTheDocument();
  });

  it("marks unverified expressions", async () => {
    renderApp("/curriculum/colloquial", {
      ...meRoute,
      [URL_BASE]: () => json(page([expression(1, { verificationStatus: "unverified", currencyStatus: "unknown", lastVerifiedAt: null })])),
    });
    const card = (await screen.findByText("样例口语1")).closest("li") as HTMLElement;
    expect(within(card).getByRole("list", { name: "Register and context" })).toHaveTextContent("Unverified");
    expect(within(card).getByRole("list", { name: "Usage warnings" })).toHaveTextContent("Not verified against a source");
  });

  it("does not link a source address that is not a web address", async () => {
    renderApp("/curriculum/colloquial", {
      ...meRoute,
      [URL_BASE]: () => json(page([expression(1, { sourceUrl: "javascript:alert(1)" })])),
    });
    const card = (await screen.findByText("样例口语1")).closest("li") as HTMLElement;
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });

  it("filters, keeps the filters in the address and clears them", async () => {
    renderApp("/curriculum/colloquial", {
      ...meRoute,
      [URL_BASE]: () => json(page([expression(1), expression(2)], { total: 12 })),
      [`${URL_BASE}?register=casual&channel=typed&q=yang`]: () =>
        json(page([expression(5, { register: "casual", channel: "typed" })])),
    });

    const form = await screen.findByRole("search", { name: "Filter colloquial expressions" });
    expect(screen.getByText("12 expressions, showing 2.")).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Term, pinyin or meaning"), "yang");
    await userEvent.selectOptions(within(form).getByLabelText("Who it suits"), "casual");
    await userEvent.selectOptions(within(form).getByLabelText("Spoken or typed"), "typed");
    await userEvent.click(within(form).getByRole("button", { name: "Filter" }));

    expect(await screen.findByText("1 expression matches, showing 1.")).toBeInTheDocument();
    expect(screen.getByLabelText("Who it suits")).toHaveValue("casual");

    await userEvent.click(screen.getByRole("link", { name: "Clear filters" }));
    expect(await screen.findByText("12 expressions, showing 2.")).toBeInTheDocument();
  });

  it("ignores filter values in the address that are not real tags", async () => {
    renderApp("/curriculum/colloquial?register=posh", { ...meRoute, [URL_BASE]: () => json(page([expression(1)])) });
    expect(await screen.findByText("1 expression, showing 1.")).toBeInTheDocument();
  });

  it("loads more only when asked", async () => {
    const next = "colloquial:synthetic-fixture:sample-2";
    renderApp("/curriculum/colloquial", {
      ...meRoute,
      [URL_BASE]: () => json(page([expression(1), expression(2)], { total: 3, nextCursor: next })),
      [`${URL_BASE}?cursor=${encodeURIComponent(next)}`]: () => json(page([expression(3)], { total: 3 })),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Show more expressions" }));
    expect(await screen.findByText("3 expressions, showing 3.")).toBeInTheDocument();
  });
});

describe("curriculum overview", () => {
  it("links to the colloquial track as something outside the syllabus", async () => {
    renderApp("/curriculum", {
      ...meRoute,
      "/api/v1/curriculum/status": () =>
        json({ activeEdition: null, dimensions: [], vocabByBand: [], manifests: [] }),
    });
    const section = await screen.findByRole("region", { name: "Outside the syllabus" });
    expect(within(section).getByRole("link", { name: "Colloquial expressions" })).toHaveAttribute(
      "href",
      "/curriculum/colloquial",
    );
    expect(section).toHaveTextContent("never counted in the numbers above");
  });
});
