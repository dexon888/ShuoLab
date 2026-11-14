import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type {
  CurriculumItemDetailResponse,
  CurriculumItemSummary,
  CurriculumItemsResponse,
  MeResponse,
} from "../../src/shared/api";
import { json, renderApp } from "./render";

const me: MeResponse = {
  owner: { email: null, authMode: "dev-bypass" },
  providers: [],
  curriculumImported: true,
  version: "test",
};

function entry(sourceId: number, over: Partial<CurriculumItemSummary> = {}): CurriculumItemSummary {
  return {
    id: `synthetic-fixture:vocab:${sourceId}`,
    sourceId,
    itemType: "vocab",
    hskBand: "1",
    hanzi: `样例词${sourceId}`,
    pinyin: `yànglì ${sourceId}`,
    partOfSpeech: "名",
    homograph: null,
    levelLabel: "1（1）",
    ...over,
  };
}

function page(items: CurriculumItemSummary[], over: Partial<CurriculumItemsResponse> = {}): CurriculumItemsResponse {
  return { editionId: "synthetic-fixture", synthetic: true, items, total: items.length, nextCursor: null, ...over };
}

const base = {
  "/api/v1/me": () => json(me),
  "/api/v1/curriculum/facets?band=1": () =>
    json({ partsOfSpeech: [{ tag: "名", count: 120 }, { tag: "动", count: 80 }] }),
};

const ITEMS = "/api/v1/curriculum/items?band=1";

describe("band page (FR-016)", () => {
  it("lists a band's entries in syllabus order and links each to its page", async () => {
    renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () => json(page([entry(1), entry(2, { homograph: "1" })], { total: 300, nextCursor: "s2" })),
    });

    expect(await screen.findByText("300 entries, showing 2.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("HSK 1");
    const links = screen.getAllByRole("link", { name: /样例词/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/curriculum/item/synthetic-fixture%3Avocab%3A1",
      "/curriculum/item/synthetic-fixture%3Avocab%3A2",
    ]);
    expect(links[1]).toHaveTextContent("form 1");
    expect(screen.getByText("样例词1")).toHaveAttribute("lang", "zh-Hans");
    expect(screen.getByRole("link", { name: "All bands" })).toHaveAttribute("href", "/curriculum");
  });

  it("marks synthetic entries as test data", async () => {
    renderApp("/curriculum/1", { ...base, [ITEMS]: () => json(page([entry(1)])) });
    expect(await screen.findByText("Test data, not HSK content.")).toBeInTheDocument();
  });

  it("shows no test-data notice for a real edition", async () => {
    renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () => json(page([entry(1)], { editionId: "hsk3-2025-11", synthetic: false })),
    });
    expect(await screen.findByText("1 entry, showing 1.")).toBeInTheDocument();
    expect(screen.queryByText(/Test data/)).not.toBeInTheDocument();
  });

  it("loads the next page only when asked, and appends it", async () => {
    const fetchMock = renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () => json(page([entry(1), entry(2)], { total: 3, nextCursor: "s2" })),
      [`${ITEMS}&cursor=s2`]: () => json(page([entry(3)], { total: 3 })),
    });

    const more = await screen.findByRole("button", { name: "Show more entries" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("cursor"))).toHaveLength(0);

    await userEvent.click(more);
    expect(await screen.findByText("3 entries, showing 3.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /样例词/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show more entries" })).not.toBeInTheDocument();
  });

  it("filters by search text and part of speech, and can clear the filters", async () => {
    const filteredUrl = `${ITEMS}&pos=${encodeURIComponent("动")}&q=yang`;
    renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () => json(page([entry(1), entry(2)], { total: 300, nextCursor: "s2" })),
      [filteredUrl]: () => json(page([entry(7, { partOfSpeech: "动" })])),
    });

    const form = await screen.findByRole("search", { name: "Filter HSK 1 entries" });
    await screen.findByRole("option", { name: "动 (80)" });
    await userEvent.type(within(form).getByLabelText("Characters or pinyin"), "  yang ");
    await userEvent.selectOptions(within(form).getByLabelText("Part of speech"), "动");
    await userEvent.click(within(form).getByRole("button", { name: "Filter" }));

    expect(await screen.findByText("1 entry matches, showing 1.")).toBeInTheDocument();
    expect(screen.getByLabelText("Characters or pinyin")).toHaveValue("yang");
    expect(screen.getByLabelText("Part of speech")).toHaveValue("动");

    await userEvent.click(screen.getByRole("link", { name: "Clear filters" }));
    expect(await screen.findByText("300 entries, showing 2.")).toBeInTheDocument();
    expect(screen.getByLabelText("Characters or pinyin")).toHaveValue("");
  });

  it("restores filters from the address", async () => {
    renderApp("/curriculum/1?q=zzz", {
      ...base,
      [`${ITEMS}&q=zzz`]: () => json(page([])),
    });
    expect(await screen.findByText("No entries match these filters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Characters or pinyin")).toHaveValue("zzz");
  });

  it("points to the import instructions when the band has no entries", async () => {
    renderApp("/curriculum/1", {
      "/api/v1/me": () => json({ ...me, curriculumImported: false }),
      "/api/v1/curriculum/facets?band=1": () => json({ partsOfSpeech: [] }),
      [ITEMS]: () => json(page([], { editionId: null, synthetic: false })),
    });
    expect(await screen.findByText("No entries are imported for this band.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /how to import the vocabulary/ })).toHaveAttribute("href", "/curriculum");
  });

  it("shows an error with a retry when the list fails to load", async () => {
    let failing = true;
    renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () =>
        failing
          ? json({ error: { code: "INTERNAL", message: "Something went wrong. Try again.", retryable: true } }, 500)
          : json(page([entry(1)])),
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load entries");
    failing = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("样例词1")).toBeInTheDocument();
  });

  it("treats the shared 7–9 band as one band and rejects single levels inside it", async () => {
    renderApp("/curriculum/7-9", {
      "/api/v1/me": () => json(me),
      "/api/v1/curriculum/facets?band=7-9": () => json({ partsOfSpeech: [] }),
      "/api/v1/curriculum/items?band=7-9": () => json(page([entry(5401, { hskBand: "7-9" })], { total: 5600 })),
    });
    expect(await screen.findByText("5,600 entries, showing 1.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("HSK 7–9");
  });

  it("shows not-found for a band that does not exist, without asking the server for entries", () => {
    const fetchMock = renderApp("/curriculum/8", { "/api/v1/me": () => json(me) });
    expect(screen.getByRole("heading", { level: 1, name: /Page not found/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/curriculum/"))).toBe(false);
  });
});

describe("entry page (FR-016)", () => {
  const id = "synthetic-fixture:vocab:10";
  const url = `/api/v1/curriculum/items/${encodeURIComponent(id)}`;

  function detail(over: Partial<CurriculumItemDetailResponse> = {}): CurriculumItemDetailResponse {
    return {
      item: {
        ...entry(10, { hanzi: "样例同形", pinyin: "yànglì tóngxíng", homograph: "1", levelLabel: "1（1）" }),
        entryRaw: "样例同形1",
        sourcePdfPage: 80,
        definition: null,
        definitionProvenance: null,
      },
      edition: { id: "synthetic-fixture", publisher: "ShuoLab test fixture", editionDate: "2025-11", synthetic: true, isActive: true },
      homographs: [entry(11, { hanzi: "样例同形", homograph: "2" })],
      sources: [
        {
          sourceUrl: "https://example.test/dataset",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          rightsNote: "Generated placeholder rows. Not HSK content.",
          importedAt: "2026-01-02T03:04:05.000Z",
        },
      ],
      progress: null,
      ...over,
    };
  }

  it("shows the entry, its syllabus details and where the data came from", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, { "/api/v1/me": () => json(me), [url]: () => json(detail()) });

    const heading = await screen.findByRole("heading", { level: 1, name: "样例同形" });
    expect(heading).toHaveAttribute("lang", "zh-Hans");
    expect(screen.getByText("yànglì tóngxíng")).toBeInTheDocument();
    expect(screen.getByText("Test data, not HSK content.")).toBeInTheDocument();
    expect(screen.getByText("Entry as printed").nextElementSibling).toHaveTextContent("样例同形1");
    expect(screen.getByText("Entry number").nextElementSibling).toHaveTextContent("10");
    expect(screen.getByRole("link", { name: "HSK 1" })).toHaveAttribute("href", "/curriculum/1");

    const source = screen.getByRole("region", { name: "Source" });
    expect(source).toHaveTextContent("0123456789ab");
    expect(source).not.toHaveTextContent("0123456789abc");
    expect(source).toHaveTextContent("imported 2026-01-02");
    expect(source).toHaveTextContent("Not HSK content.");
    expect(within(source).getByRole("link")).toHaveAttribute("href", "https://example.test/dataset");
    expect(source).toHaveTextContent("Page in the syllabus PDF");
  });

  it("says there is no definition rather than inventing one", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, { "/api/v1/me": () => json(me), [url]: () => json(detail()) });
    const meaning = await screen.findByRole("region", { name: "Meaning" });
    expect(meaning).toHaveTextContent("No definition.");
    expect(meaning).toHaveTextContent("does not invent them");
  });

  it("shows an imported definition together with its source", async () => {
    const d = detail();
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () => json({ ...d, item: { ...d.item, definition: "placeholder gloss", definitionProvenance: "test lexicon" } }),
    });
    const meaning = await screen.findByRole("region", { name: "Meaning" });
    expect(meaning).toHaveTextContent("placeholder gloss");
    expect(meaning).toHaveTextContent("Source: test lexicon.");
  });

  it("links to other entries with the same written form", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, { "/api/v1/me": () => json(me), [url]: () => json(detail()) });
    const same = await screen.findByRole("region", { name: "Same written form" });
    const link = within(same).getByRole("link");
    expect(link).toHaveAttribute("href", "/curriculum/item/synthetic-fixture%3Avocab%3A11");
    expect(link).toHaveTextContent("form 2");
    expect(link).toHaveTextContent("entry 11");
  });

  it("claims no practice evidence", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () => json(detail({ homographs: [] })),
    });
    expect(await screen.findByRole("region", { name: "Your practice" })).toHaveTextContent("Nothing recorded.");
    expect(screen.queryByRole("region", { name: "Same written form" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it("does not turn a non-web source address into a link", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () =>
        json(detail({ sources: [{ sourceUrl: "javascript:alert(1)", commitSha: null, rightsNote: "n", importedAt: "2026-01-02T00:00:00.000Z" }] })),
    });
    const source = await screen.findByRole("region", { name: "Source" });
    expect(within(source).queryByRole("link")).not.toBeInTheDocument();
    expect(source).toHaveTextContent("javascript:alert(1)");
  });

  it("shows the server's message when the entry does not exist", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () => json({ error: { code: "NOT_FOUND", message: "No such curriculum entry.", retryable: false } }, 404),
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No such curriculum entry.");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows not-found for a malformed entry address without asking the server", () => {
    const fetchMock = renderApp("/curriculum/item/example", { "/api/v1/me": () => json(me) });
    expect(screen.getByRole("heading", { level: 1, name: /Page not found/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/curriculum/"))).toBe(false);
  });
});
