import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { prepareColloquialImport, type PrepareColloquialResult } from "../../src/server/services/colloquial-import";
import { applyStatements } from "../../src/server/services/curriculum-import";
import {
  colloquialResponseSchema,
  curriculumStatusResponseSchema,
  errorEnvelopeSchema,
  meResponseSchema,
} from "../../src/shared/api";
import { getColloquialSource, usageWarnings, type ColloquialSource } from "../../src/shared/colloquial";
import {
  SYNTHETIC_COLLOQUIAL_COLUMNS,
  colloquialToCsv,
  colloquialToJson,
  makeSyntheticColloquial,
  type SyntheticColloquialRecord,
} from "../fixtures/synthetic-colloquial";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

function source(key: string): ColloquialSource {
  const found = getColloquialSource(key);
  if (!found) throw new Error(`Unknown source ${key}`);
  return found;
}
const SOURCE = source("synthetic-fixture");
const REAL_SOURCE = source("hearmandarin");

function prep(name: string, content: string | Uint8Array, source = SOURCE): PrepareColloquialResult {
  return prepareColloquialImport({ source, file: sourceFile(name, content), importedAt: "2026-01-01T00:00:00.000Z" });
}

function codes(result: PrepareColloquialResult): string[] {
  return result.ok ? [] : [...new Set(result.issues.map((i) => i.code))].sort();
}

function withChange(index: number, change: Partial<SyntheticColloquialRecord>) {
  return makeSyntheticColloquial().map((r, i) => (i === index ? { ...r, ...change } : r));
}

describe("colloquial import validation", () => {
  it("accepts the CSV form and maps the source's register words", () => {
    const result = prep("slang.csv", colloquialToCsv(makeSyntheticColloquial()));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.summary).toMatchObject({
      total: 12,
      byRegister: { neutral: 3, casual: 6, very_informal: 3 },
      byChannel: { both: 8, typed: 4 },
      byStatus: { steady: 6, hot: 3, fading: 3 },
    });
    expect(result.rows[0]).toMatchObject({ slug: "sample-01", register: "neutral", meaningEn: "placeholder meaning 1" });
    expect(result.rows[3]?.register).toBe("very_informal");
  });

  it("accepts a CSV with a byte-order mark and CRLF line ends", () => {
    const csv = "﻿" + colloquialToCsv(makeSyntheticColloquial()).replaceAll("\n", "\r\n");
    expect(prep("slang.csv", csv).ok).toBe(true);
  });

  it("accepts the JSON form and reads its version", () => {
    const result = prep("slang.json", colloquialToJson(makeSyntheticColloquial()));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.summary.datasetVersion).toBe("2026-01-01");
    expect(result.rows).toHaveLength(12);
  });

  it("rejects a JSON file whose stated count does not match, as truncated", () => {
    const result = prep("slang.json", colloquialToJson(makeSyntheticColloquial(), { count: 185 }));
    expect(codes(result)).toEqual(["COUNT_MISMATCH"]);
  });

  it.each([
    ["a duplicate identifier", { slug: "sample-01" }, 1, "DUPLICATE_SLUG"],
    ["an invalid identifier", { slug: "Not Valid!" }, 0, "INVALID_SLUG"],
    ["an unknown register", { register: "posh" }, 0, "UNKNOWN_REGISTER"],
    ["an unknown channel", { channel: "sung" }, 0, "UNKNOWN_CHANNEL"],
    ["an unknown status", { status: "viral" }, 0, "UNKNOWN_STATUS"],
    ["a malformed checked date", { checked: "Sept 2026" }, 0, "INVALID_DATE"],
    ["an impossible month", { checked: "2026-13" }, 0, "INVALID_DATE"],
    ["a non-https entry address", { url: "javascript:alert(1)" }, 0, "INVALID_URL"],
    ["an http entry address", { url: "http://example.test/x" }, 0, "INVALID_URL"],
    ["a missing term", { term: "" }, 0, "MISSING_FIELD"],
    ["a missing meaning", { real_en: "  " }, 0, "MISSING_FIELD"],
    ["damaged text", { term: "样�例" }, 0, "CORRUPT_TEXT"],
    ["an over-long term", { term: "样".repeat(81) }, 0, "TOO_LONG"],
  ])("rejects %s", (_name, change, index, code) => {
    const result = prep("slang.csv", colloquialToCsv(withChange(index, change)));
    expect(codes(result)).toEqual([code]);
    if (!result.ok) expect(result.issues[0]?.position).toBe(index + 2);
  });

  it("rejects a missing required column, invalid UTF-8, bad JSON and an empty file", () => {
    const columns = SYNTHETIC_COLLOQUIAL_COLUMNS.filter((c) => c !== "real_en");
    expect(codes(prep("slang.csv", colloquialToCsv(makeSyntheticColloquial(), columns)))).toEqual(["MISSING_COLUMN"]);
    expect(codes(prep("slang.csv", new Uint8Array([0xff, 0xfe, 0x41])))).toEqual(["INVALID_UTF8"]);
    expect(codes(prep("slang.json", "{not json"))).toEqual(["BAD_FORMAT"]);
    expect(codes(prep("slang.json", JSON.stringify({ terms: "nope" })))).toEqual(["BAD_FORMAT"]);
    expect(codes(prep("slang.json", JSON.stringify({ terms: [{ ...makeSyntheticColloquial()[0], term: 5.5, slug: ["x"] }] })))).toEqual(["BAD_FORMAT"]);
    expect(codes(prep("slang.csv", ""))).toEqual(["BAD_FORMAT"]);
    expect(codes(prep("slang.csv", SYNTHETIC_COLLOQUIAL_COLUMNS.join(",") + "\n"))).toEqual(["NO_ROWS"]);
  });

  it("stores an undated status as unknown, and optional fields as empty", () => {
    const columns = SYNTHETIC_COLLOQUIAL_COLUMNS.filter((c) => c !== "literal_en" && c !== "since");
    const result = prep("slang.csv", colloquialToCsv(withChange(1, { checked: "", pinyin: "" }), columns));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.rows[1]).toMatchObject({ currencyStatus: "unknown", lastVerifiedAt: null, pinyin: null, literalEn: null, inUseSince: null });
    expect(result.rows[0]?.currencyStatus).toBe("steady");
  });

  it("reports every bad row, not just the first", () => {
    const records = makeSyntheticColloquial().map((r, i) => (i % 2 === 0 ? { ...r, channel: "sung" } : r));
    const result = prep("slang.csv", colloquialToCsv(records));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(6);
  });
});

describe("usage warnings", () => {
  it("warns about typed-only, very informal and fading expressions", () => {
    const warnings = usageWarnings({ register: "very_informal", channel: "typed", currencyStatus: "fading", verificationStatus: "verified" });
    expect(warnings).toHaveLength(3);
    expect(warnings.join(" ")).toMatch(/swear or insult/);
    expect(warnings.join(" ")).toMatch(/Typed only/);
    expect(warnings.join(" ")).toMatch(/Fading/);
  });

  it("has nothing to warn about for a neutral, established expression", () => {
    expect(usageWarnings({ register: "neutral", channel: "both", currencyStatus: "steady", verificationStatus: "verified" })).toEqual([]);
  });

  it("flags unverified expressions first", () => {
    const warnings = usageWarnings({ register: "neutral", channel: "both", currencyStatus: "unknown", verificationStatus: "unverified" });
    expect(warnings[0]).toMatch(/Not verified/);
  });
});

describe("colloquial track in the database and API (FR-017)", () => {
  let database: TestDatabase;
  const app = createApp();
  const env = () => ({ DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });

  async function get(path: string) {
    return app.request(`http://localhost/api/v1${path}`, {}, env());
  }
  async function list(query = "") {
    const res = await get(`/colloquial${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return colloquialResponseSchema.parse(await res.json());
  }
  async function status() {
    return curriculumStatusResponseSchema.parse(await (await get("/curriculum/status")).json());
  }

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 60_000);
  afterAll(async () => {
    await database.dispose();
  });

  it("returns an empty track before anything is imported", async () => {
    expect(await list()).toEqual({ items: [], total: 0, nextCursor: null, sources: [] });
  });

  it("requires the owner", async () => {
    const res = await app.request("http://localhost/api/v1/colloquial", {}, { DB: database.db, APP_ENV: "production" });
    expect(res.status).toBe(503);
  });

  it("never changes any HSK count, with or without vocabulary imported", async () => {
    const before = await status();
    const result = prep("slang.csv", colloquialToCsv(makeSyntheticColloquial()));
    if (!result.ok) throw new Error("fixture rejected");
    await applyStatements(database.db, result.statements);

    expect(await status()).toEqual(before);
    expect(before.dimensions.every((d) => d.importedCount === 0)).toBe(true);
    const me = meResponseSchema.parse(await (await get("/me")).json());
    expect(me.curriculumImported).toBe(false);

    const vocab = prepare([sourceFile("all.csv", toCsv(makeSyntheticRecords()))]);
    if (!vocab.ok) throw new Error("vocab fixture rejected");
    await applyStatements(database.db, vocab.statements);

    const after = await status();
    expect(after.dimensions.find((d) => d.itemType === "vocab")?.importedCount).toBe(11000);
    expect(after.vocabByBand.reduce((sum, b) => sum + b.importedNew, 0)).toBe(11000);
    const items = await (await get("/curriculum/items?limit=1")).json();
    expect((items as { total: number }).total).toBe(11000);
    const rows = await database.db.prepare("SELECT COUNT(*) AS n FROM curriculum_items").first<{ n: number }>();
    expect(rows?.n).toBe(11000);
  }, 60_000);

  it("has no HSK band column at all", async () => {
    const columns = await database.db.prepare("SELECT name FROM pragma_table_info('colloquial_expressions')").all<{ name: string }>();
    const names = columns.results.map((c) => c.name);
    expect(names).toContain("register");
    expect(names.some((n) => /hsk|band|level/.test(n))).toBe(false);
  });

  it("is idempotent: importing the same file again changes nothing", async () => {
    const snapshot = async () =>
      (await database.db.prepare("SELECT * FROM colloquial_expressions ORDER BY id").all()).results;
    const before = await snapshot();
    const again = prep("slang.csv", colloquialToCsv(makeSyntheticColloquial()));
    if (!again.ok) throw new Error("fixture rejected");
    await applyStatements(database.db, again.statements);
    expect(await snapshot()).toEqual(before);
    expect(before).toHaveLength(12);
  });

  it("lists expressions with register, channel, currency and source", async () => {
    const page = await list();
    expect(page.total).toBe(12);
    expect(page.items[0]).toMatchObject({
      id: "colloquial:synthetic-fixture:sample-01",
      term: "样例口语1",
      meaningEn: "placeholder meaning 1",
      register: "neutral",
      channel: "both",
      currencyStatus: "steady",
      lastVerifiedAt: "2026-09",
      region: null,
      verificationStatus: "verified",
      sourceUrl: "https://example.test/colloquial/sample-01",
    });
    expect(page.sources).toEqual([
      expect.objectContaining({ key: "synthetic-fixture", synthetic: true, count: 12, importedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
  });

  it("credits a real source with its licence and attribution", async () => {
    const result = prep("slang.json", colloquialToJson(makeSyntheticColloquial(2)), REAL_SOURCE);
    if (!result.ok) throw new Error("fixture rejected");
    await applyStatements(database.db, result.statements);

    const page = await list();
    expect(page.total).toBe(14);
    const credit = page.sources.find((s) => s.key === "hearmandarin");
    expect(credit).toMatchObject({
      name: "HearMandarin",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "HearMandarin (https://hearmandarin.com)",
      synthetic: false,
      count: 2,
      datasetVersion: "2026-01-01",
    });
    await database.db.prepare("DELETE FROM colloquial_expressions WHERE source_key = 'hearmandarin'").run();
  });

  it("filters by register, channel, status and text", async () => {
    expect((await list("?register=very_informal")).total).toBe(3);
    expect((await list("?channel=typed")).total).toBe(4);
    expect((await list("?status=fading")).total).toBe(3);
    expect((await list("?register=casual&channel=typed")).items.every((i) => i.register === "casual" && i.channel === "typed")).toBe(true);
    expect((await list("?q=" + encodeURIComponent("口语12"))).items.map((i) => i.term)).toEqual(["样例口语12"]);
    expect((await list("?q=" + encodeURIComponent("meaning 7"))).total).toBe(1);
    expect((await list("?q=" + encodeURIComponent("%"))).total).toBe(0);
    expect((await list("?q=" + encodeURIComponent("' OR 1=1 --"))).total).toBe(0);
  });

  it("pages through every expression exactly once", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(`?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor && seen.length < 50);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("rejects malformed parameters", async () => {
    for (const query of ["?register=posh", "?channel=sung", "?status=viral", "?limit=0", "?limit=101", "?cursor=nope"]) {
      const res = await get(`/colloquial${query}`);
      expect(res.status, query).toBe(400);
      expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe("BAD_REQUEST");
    }
  });

  it("the database refuses values outside the allowed tags", async () => {
    const insert = (register: string, channel: string) =>
      database.db
        .prepare(
          "INSERT INTO colloquial_expressions (id, source_key, slug, term, meaning_en, register, channel, source_url, license, attribution, imported_at) VALUES (?1, 'x', ?1, 't', 'm', ?2, ?3, 'https://example.test', 'l', 'a', 'now')",
        )
        .bind(`bad-${register}-${channel}`, register, channel)
        .run();
    await expect(insert("posh", "both")).rejects.toThrow();
    await expect(insert("casual", "sung")).rejects.toThrow();
  });
});
