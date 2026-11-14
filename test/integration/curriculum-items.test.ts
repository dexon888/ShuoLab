import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { splitPartOfSpeech } from "../../src/server/services/curriculum-items";
import {
  curriculumFacetsResponseSchema,
  curriculumItemDetailResponseSchema,
  curriculumItemsResponseSchema,
  errorEnvelopeSchema,
} from "../../src/shared/api";
import { SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

let database: TestDatabase;
const app = createApp();

async function get(path: string, authenticated = true) {
  const env = authenticated
    ? { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" }
    : { DB: database.db, APP_ENV: "production" };
  return app.request(`http://localhost/api/v1${path}`, {}, env);
}

async function items(query = "") {
  const res = await get(`/curriculum/items${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return curriculumItemsResponseSchema.parse(await res.json());
}

beforeAll(async () => {
  database = await createTestDatabase();
  // Synthetic rows, with a few parts of speech changed to exercise tag matching.
  const records = makeSyntheticRecords().map((r) => {
    if (r.id === 1) return { ...r, part_of_speech: "数、（副）" };
    if (r.id === 2) return { ...r, part_of_speech: "数量" };
    if (r.id === 3) return { ...r, part_of_speech: "动、介" };
    if (r.id === 4) return { ...r, hanzi: "100%_样例", entry: "100%_样例", pinyin: "bǎi fēn" };
    return r;
  });
  const result = prepare([sourceFile("all.csv", toCsv(records))]);
  if (!result.ok) throw new Error(JSON.stringify(result.issues.slice(0, 3)));
  await applyStatements(database.db, result.statements);
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

describe("GET /curriculum/items", () => {
  it("requires the owner", async () => {
    expect((await get("/curriculum/items", false)).status).toBe(503);
    expect((await get("/curriculum/items/synthetic-fixture:vocab:1", false)).status).toBe(503);
    expect((await get("/curriculum/facets", false)).status).toBe(503);
  });

  it("returns one page, never the whole corpus", async () => {
    const page = await items();
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(11000);
    expect(page.nextCursor).not.toBeNull();
    expect(page).toMatchObject({ editionId: SYNTHETIC_EDITION_ID, synthetic: true });
    expect(page.items.map((i) => i.sourceId)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("caps the page size and rejects out-of-range limits", async () => {
    expect((await items("?limit=100")).items).toHaveLength(100);
    for (const limit of ["101", "0", "-1", "abc", "1.5"]) {
      expect((await get(`/curriculum/items?limit=${limit}`)).status, limit).toBe(400);
    }
  });

  it("filters by band with the right totals", async () => {
    const band2 = await items("?band=2&limit=100");
    expect(band2.total).toBe(200);
    expect(band2.items.every((i) => i.hskBand === "2")).toBe(true);
    expect(band2.items[0]?.sourceId).toBe(301);

    expect((await items("?band=7-9&limit=1")).total).toBe(5600);
  });

  it("walks every page of a band exactly once with a stable cursor", async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await items(`?band=3&limit=64${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.items.map((i) => i.sourceId));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    expect(pages).toBe(8); // 500 entries / 64 per page
    expect(seen).toEqual(Array.from({ length: 500 }, (_, i) => 501 + i));
  });

  it("returns no next cursor when the last page is exactly full", async () => {
    const page = await items("?band=2&limit=100&cursor=" + (await items("?band=2&limit=100")).nextCursor);
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects malformed cursors, bands, types and states", async () => {
    for (const query of ["?cursor=zzz", "?cursor=s", "?cursor=s-1", "?band=7", "?band=8", "?type=slang", "?state=fluent"]) {
      const res = await get(`/curriculum/items${query}`);
      expect(res.status, query).toBe(400);
      expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe("BAD_REQUEST");
    }
  });

  it("matches one part-of-speech tag exactly, including bracketed tags", async () => {
    const adverbs = await items("?pos=副");
    expect(adverbs.items.map((i) => i.sourceId)).toEqual([1]);

    // 数 matches "数、（副）" but not the different tag 数量.
    const numerals = await items("?pos=数");
    expect(numerals.items.map((i) => i.sourceId)).toEqual([1]);
    expect((await items("?pos=数量")).items.map((i) => i.sourceId)).toEqual([2]);
    expect((await items("?pos=介")).items.map((i) => i.sourceId)).toEqual([3]);
  });

  it("searches the start of the written form or any part of the pinyin", async () => {
    const byHanzi = await items("?q=样例同形");
    expect(byHanzi.items.map((i) => i.sourceId)).toEqual([10, 11]);

    const byPinyin = await items("?q=" + encodeURIComponent("tóngxíng"));
    expect(byPinyin.total).toBe(2);
  });

  it("treats % and _ in a search as plain text", async () => {
    expect((await items("?q=" + encodeURIComponent("100%_"))).items.map((i) => i.sourceId)).toEqual([4]);
    expect((await items("?q=" + encodeURIComponent("%"))).total).toBe(0);
    expect((await items("?q=_")).total).toBe(0);
  });

  it("is not injectable through filters", async () => {
    const res = await items("?q=" + encodeURIComponent("' OR 1=1 --"));
    expect(res.total).toBe(0);
    const pos = await items("?pos=" + encodeURIComponent("名' OR '1'='1"));
    expect(pos.total).toBe(0);
    expect((await items("?limit=1")).total).toBe(11000);
  });

  it("reports every item as unseen until evidence exists", async () => {
    expect((await items("?state=unseen&band=1")).total).toBe(300);
    for (const state of ["introduced", "practiced", "developing", "mastered"]) {
      const page = await items(`?state=${state}`);
      expect(page).toMatchObject({ total: 0, items: [], nextCursor: null });
    }
  });

  it("returns nothing for syllabus sections that are not imported", async () => {
    expect((await items("?type=grammar")).total).toBe(0);
  });
});

describe("GET /curriculum/facets", () => {
  it("lists part-of-speech tags with counts, split from combined values", async () => {
    const res = await get("/curriculum/facets?band=1");
    const facets = curriculumFacetsResponseSchema.parse(await res.json());
    const byTag = Object.fromEntries(facets.partsOfSpeech.map((f) => [f.tag, f.count]));
    expect(byTag["副"]).toBe(1);
    expect(byTag["数"]).toBe(1);
    expect(byTag["数量"]).toBe(1);
    expect(byTag["动"]).toBe(1);
    expect(byTag["介"]).toBe(1);
    expect(facets.partsOfSpeech[0]?.tag).toBe("名");
    expect(Object.keys(byTag).some((t) => /[（）、]/.test(t))).toBe(false);
  });

  it("rejects an invalid band", async () => {
    expect((await get("/curriculum/facets?band=9")).status).toBe(400);
  });

  it("splits tags the way the syllabus writes them", () => {
    expect(splitPartOfSpeech("数、（副）")).toEqual(["数", "副"]);
    expect(splitPartOfSpeech("名")).toEqual(["名"]);
    expect(splitPartOfSpeech(" 动 、 介 ")).toEqual(["动", "介"]);
    expect(splitPartOfSpeech("")).toEqual([]);
  });
});

describe("GET /curriculum/items/:id", () => {
  async function detail(id: string) {
    const res = await get(`/curriculum/items/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    return curriculumItemDetailResponseSchema.parse(await res.json());
  }

  it("returns the entry with its provenance", async () => {
    const d = await detail("synthetic-fixture:vocab:50");
    expect(d.item).toMatchObject({
      id: "synthetic-fixture:vocab:50",
      sourceId: 50,
      hskBand: "1",
      hanzi: "样例词50",
      entryRaw: "样例词50",
      levelLabel: "1（2）",
      sourcePdfPage: 80,
      definition: null,
      definitionProvenance: null,
    });
    expect(d.edition).toMatchObject({ id: SYNTHETIC_EDITION_ID, synthetic: true, isActive: true });
    expect(d.sources).toEqual([
      expect.objectContaining({ sourceUrl: "generated:test", commitSha: null }),
    ]);
    expect(d.homographs).toEqual([]);
    expect(d.progress).toBeNull();
  });

  it("links homographs to each other, and only to each other", async () => {
    const first = await detail("synthetic-fixture:vocab:10");
    expect(first.item.homograph).toBe("1");
    expect(first.homographs.map((h) => [h.id, h.homograph])).toEqual([["synthetic-fixture:vocab:11", "2"]]);
    const second = await detail("synthetic-fixture:vocab:11");
    expect(second.homographs.map((h) => h.id)).toEqual(["synthetic-fixture:vocab:10"]);
  });

  it("never returns a definition without its provenance", async () => {
    await database.db
      .prepare("UPDATE curriculum_items SET definition = 'placeholder gloss', definition_provenance = 'test lexicon' WHERE source_id = 20")
      .run();
    const d = await detail("synthetic-fixture:vocab:20");
    expect(d.item).toMatchObject({ definition: "placeholder gloss", definitionProvenance: "test lexicon" });
  });

  it("returns 404 for an id that was never imported, including another edition's", async () => {
    for (const id of ["synthetic-fixture:vocab:11001", "hsk3-2025-11:vocab:1", "synthetic-fixture:grammar:1"]) {
      const res = await get(`/curriculum/items/${encodeURIComponent(id)}`);
      expect(res.status, id).toBe(404);
    }
  });

  it("returns 400 for a malformed id", async () => {
    for (const id of ["nope", "synthetic-fixture:vocab:abc", "synthetic-fixture:slang:1", "1"]) {
      const res = await get(`/curriculum/items/${encodeURIComponent(id)}`);
      expect(res.status, id).toBe(400);
    }
  });
});

describe("with nothing imported", () => {
  it("returns empty results rather than an error", async () => {
    const empty = await createTestDatabase();
    try {
      const env = { DB: empty.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" };
      const res = await app.request("http://localhost/api/v1/curriculum/items?band=1", {}, env);
      expect(curriculumItemsResponseSchema.parse(await res.json())).toEqual({
        editionId: null,
        synthetic: false,
        items: [],
        total: 0,
        nextCursor: null,
      });
      const facets = await app.request("http://localhost/api/v1/curriculum/facets", {}, env);
      expect(await facets.json()).toEqual({ partsOfSpeech: [] });
    } finally {
      await empty.dispose();
    }
  });
});
