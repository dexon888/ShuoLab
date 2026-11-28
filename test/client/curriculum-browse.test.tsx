import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type {
  CurriculumItemDetailResponse,
  CurriculumItemSummary,
  CurriculumItemsResponse,
  MeResponse,
} from "../../src/shared/api";
import { json, renderApp, savedSettings } from "./render";

const me: MeResponse = {
  owner: { email: null, authMode: "dev-bypass" },
  settings: savedSettings(),
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
    note: null,
    state: "unseen",
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

  it("filters by your progress and labels entries you have met", async () => {
    renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () => json(page([entry(1), entry(2, { state: "developing" })], { total: 300 })),
      [`${ITEMS}&state=developing`]: () => json(page([entry(2, { state: "developing" })])),
    });
    expect(await screen.findByRole("link", { name: /样例词2/ })).toHaveTextContent("Developing");
    // An entry with no evidence carries no label.
    expect(screen.getByRole("link", { name: /样例词1/ }).textContent).not.toMatch(/Not met|Met|Developing/);
    const form = screen.getByRole("search", { name: "Filter HSK 1 entries" });
    await userEvent.selectOptions(within(form).getByLabelText("Your progress"), "developing");
    await userEvent.click(within(form).getByRole("button", { name: "Filter" }));
    expect(await screen.findByText("1 entry matches, showing 1.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your progress")).toHaveValue("developing");
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
    expect(screen.getByRole("link", { name: /how to import it/ })).toHaveAttribute("href", "/curriculum");
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
        details: null,
        flag: null,
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
      progress: {
        bySkill: (["listening", "speaking", "reading", "writing"] as const).map((skill) => ({
          skill,
          state: "unseen" as const,
          successDays: 0,
          failureCount: 0,
          lastAttemptAt: null,
          lastSuccessAt: null,
        })),
      },
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

  it("shows every skill as not met when there is no evidence", async () => {
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () => json(detail({ homographs: [] })),
    });
    const practice = await screen.findByRole("region", { name: "Your practice" });
    expect(within(practice).getAllByText("Not met")).toHaveLength(4);
    expect(screen.queryByRole("region", { name: "Same written form" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it("shows each skill's state from the evidence, with recall days and misses", async () => {
    const base = detail();
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () =>
        json(
          detail({
            progress: {
              bySkill: base.progress.bySkill.map((p) =>
                p.skill === "reading"
                  ? { ...p, state: "developing", successDays: 2, failureCount: 1, lastAttemptAt: "2026-03-04T10:00:00.000Z", lastSuccessAt: "2026-03-03T10:00:00.000Z" }
                  : p.skill === "listening"
                    ? { ...p, state: "introduced" }
                    : p,
              ),
            },
          }),
        ),
    });
    const practice = await screen.findByRole("region", { name: "Your practice" });
    expect(within(practice).getByText("Developing")).toBeInTheDocument();
    expect(within(practice).getByText("Recalled on 2 days, missed 1 time")).toBeInTheDocument();
    expect(within(practice).getByText("Met, not yet reviewed")).toBeInTheDocument();
    expect(within(practice).getAllByText("Not met")).toHaveLength(2);
    expect(within(practice).getByText(/this app's rule, not an HSK/)).toBeInTheDocument();
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

describe("grammar, characters, topics and tasks (FR-016)", () => {
  const grammar = (n: number) =>
    entry(n, { id: `hsk3-2025-11:grammar:${n}`, itemType: "grammar", hanzi: `样例语法${n}`, pinyin: null, partOfSpeech: null, levelLabel: "HSK1", note: "词类 · 名词" });

  it("switches sections with tabs, lists grammar points with their kind, and says the source is not verified", async () => {
    renderApp("/curriculum/1", {
      ...base,
      [ITEMS]: () => json(page([entry(1)])),
      "/api/v1/curriculum/items?band=1&type=grammar": () => json(page([grammar(1)], { editionId: "hsk3-2025-11", synthetic: false })),
    });
    const tabs = await screen.findByRole("navigation", { name: "Syllabus sections" });
    expect(within(tabs).getByRole("link", { name: /Vocabulary/ })).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(tabs).getByRole("link", { name: /Grammar/ }));

    expect(await screen.findByText("样例语法1")).toBeInTheDocument();
    expect(screen.getByText("词类 · 名词")).toBeInTheDocument();
    expect(screen.getByText("1 grammar point, showing 1.")).toBeInTheDocument();
    expect(screen.getByText(/second-hand transcription/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Part of speech")).not.toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: /Grammar/ })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the section when filtering", async () => {
    const asked: string[] = [];
    renderApp("/curriculum/1?type=task", {
      ...base,
      "/api/v1/curriculum/items?band=1&type=task": () => (asked.push("all"), json(page([]))),
      "/api/v1/curriculum/items?band=1&type=task&q=%E9%97%AE": () => (asked.push("q"), json(page([]))),
    });
    await screen.findByText("No tasks are imported for this band.");
    await userEvent.type(screen.getByLabelText("Search"), "问");
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByText("No tasks match these filters.")).toBeInTheDocument();
    expect(asked).toEqual(["all", "q"]);
  });

  it("shows a grammar point's details and examples", async () => {
    const id = "hsk3-2025-11:grammar:3";
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [`/api/v1/curriculum/items/${encodeURIComponent(id)}`]: () =>
        json({
          item: {
            ...grammar(3),
            id,
            entryRaw: null,
            sourcePdfPage: null,
            definition: null,
            definitionProvenance: null,
            details: { kind: "grammar", grammarType: "词类", category: "名词", detail: "方位名词", examples: ["桌子上有几本书？", "他们都在国外。"] },
          },
          edition: { id: "hsk3-2025-11", publisher: "Test", editionDate: "2025-11", synthetic: false, isActive: true },
          homographs: [],
          sources: [{ sourceUrl: "https://example.test/sections", commitSha: "f".repeat(40), rightsNote: "Licensed CC BY 4.0.", importedAt: "2026-11-26T00:00:00.000Z" }],
          progress: { bySkill: ["listening", "speaking", "reading", "writing"].map((skill) => ({ skill, state: "unseen", successDays: 0, failureCount: 0, lastAttemptAt: null, lastSuccessAt: null })) },
        }),
    });
    expect(await screen.findByRole("heading", { level: 1, name: "样例语法3" })).toBeInTheDocument();
    expect(screen.getByText("方位名词")).toBeInTheDocument();
    expect(screen.getByText("桌子上有几本书？")).toBeInTheDocument();
    expect(screen.getByText(/not checked against the official document/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Meaning" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /HSK 1.*Grammar/ })).toHaveAttribute("href", "/curriculum/1?type=grammar");
    expect(screen.getByText("Licensed CC BY 4.0.")).toBeInTheDocument();
  });
});

describe("flagging an unverified row (SPEC §2.5 rule 8, FR-031)", () => {
  it("flags a grammar point with a note from its page", async () => {
    const id = "hsk3-2025-11:grammar:7";
    const url = `/api/v1/curriculum/items/${encodeURIComponent(id)}`;
    let flagged: { note: string | null; flaggedAt: string } | null = null;
    const sent: unknown[] = [];
    renderApp(`/curriculum/item/${encodeURIComponent(id)}`, {
      "/api/v1/me": () => json(me),
      [url]: () =>
        json({
          item: {
            ...entry(7, { id, itemType: "grammar", hanzi: "样例语法", pinyin: null, partOfSpeech: null, note: "词类" }),
            entryRaw: null,
            sourcePdfPage: null,
            definition: null,
            definitionProvenance: null,
            details: { kind: "grammar", grammarType: "词类", category: null, detail: null, examples: ["样例。"] },
            flag: flagged,
          },
          edition: { id: "hsk3-2025-11", publisher: "Test", editionDate: "2025-11", synthetic: false, isActive: true },
          homographs: [],
          sources: [],
          progress: { bySkill: ["listening", "speaking", "reading", "writing"].map((skill) => ({ skill, state: "unseen", successDays: 0, failureCount: 0, lastAttemptAt: null, lastSuccessAt: null })) },
        }),
      [`POST ${url}/flag`]: (init) => {
        sent.push(JSON.parse(String(init?.body)));
        flagged = { note: "Wrong example", flaggedAt: "2026-03-04T10:00:00.000Z" };
        return json({ flag: { itemId: id, ...flagged } }, 201);
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Flag as wrong…" }));
    await userEvent.type(screen.getByLabelText("What is wrong? (optional)"), "Wrong example");
    await userEvent.click(screen.getByRole("button", { name: "Flag it" }));
    expect(await screen.findByText(/You flagged this as wrong on 2026-03-04/)).toBeInTheDocument();
    expect(screen.getByText("Note: Wrong example")).toBeInTheDocument();
    expect(sent).toEqual([{ note: "Wrong example" }]);
  });
});

describe("meanings in the band list (SPEC §2.6 rule 2, FR-033)", () => {
  it("shows a word's short sourced meaning beside its pinyin", async () => {
    renderApp("/curriculum/1", { ...base, [ITEMS]: () => json(page([entry(1, { note: "placeholder meaning" })])) });
    expect(await screen.findByText("placeholder meaning")).toBeInTheDocument();
  });
});
