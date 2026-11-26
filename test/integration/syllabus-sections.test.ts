import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import {
  applyStatements,
  prepareSectionsImport,
  verifyDatabase,
  type QueryFn,
  type StoredVocab,
} from "../../src/server/services/curriculum-import";
import { curriculumStatusResponseSchema } from "../../src/shared/api";
import { HSK_BANDS, SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile, TEST_SOURCE } from "../helpers/import";

// Generated placeholder rows in the shape of the sections source. Not HSK content.
const LEVELS = HSK_BANDS.map((b) => `HSK${b}`);
const records = makeSyntheticRecords();

function grammarCsv(extra = "") {
  const rows = LEVELS.map((l, i) => `${l},样例语法${i},词类,名词,,样例句一。\\n样例句二。`);
  // A point named only in grammarDetail, as some source rows are.
  rows.push(`HSK1,,句子的类型,句类,样例陈述句,样例句三。`);
  return ["examLevelId,content,grammarType,categoryType,grammarDetail,cases", ...rows].join("\n") + extra;
}
const hanziCsv = (extra = "") =>
  ["examLevelId,word,type", ...LEVELS.map((l, i) => `${l},${"一二三四五六七"[i]},1`), "HSK2,写,2"].join("\n") + extra;
const topicCsv = (extra = "") =>
  ["examLevelId,children,level1Content,level2Content,level3Content", ...LEVELS.map((l, i) => `${l},[],样例领域,样例主题,样例细节${i}`)].join("\n") + extra;
const taskCsv = (extra = "") =>
  ["examLevelId,children,level1Content,level2Content", ...LEVELS.map((l, i) => `${l},[],样例任务${i},能完成样例任务。`)].join("\n") + extra;
const vocabCsv = (mutate: (r: (typeof records)[number]) => string[] = (r) => ["1", r.hanzi, r.pinyin, "", String(r.id), "x"]) =>
  ["type,word,pinyin,cixing,sort,levelName", ...records.map((r) => mutate(r).join(","))].join("\n");

function files(over: Partial<Record<string, string>> = {}) {
  const base: Record<string, string> = {
    "hsk_grammar.csv": grammarCsv(),
    "hsk_hanzi.csv": hanziCsv(),
    "hsk_topic.csv": topicCsv(),
    "hsk_task.csv": taskCsv(),
    "hsk_vocabulary.csv": vocabCsv(),
    ...over,
  };
  return Object.entries(base)
    .filter(([, v]) => v !== "")
    .map(([name, content]) => sourceFile(name, content as string));
}

const stored: StoredVocab[] = records.map((r) => ({ sourceId: r.id, hanzi: r.hanzi, pinyin: r.pinyin }));

function run(over: Partial<Record<string, string>> = {}, vocab = stored) {
  return prepareSectionsImport({
    editionId: SYNTHETIC_EDITION_ID,
    files: files(over),
    storedVocab: vocab,
    source: TEST_SOURCE,
    importedAt: "2026-11-26T00:00:00.000Z",
  });
}
const codes = (r: ReturnType<typeof run>) => (r.ok ? [] : r.issues.map((i) => i.code));

describe("checking the sections source (SPEC §2.2)", () => {
  it("accepts a clean source and counts every section by band", () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.vocabularyMatched).toBe(11000);
    expect(result.summary.counts.grammar["1"]).toBe(2);
    expect(result.summary.counts.character["2"]).toBe(2);
    expect(result.summary.counts.topic["7-9"]).toBe(1);
  });

  it("refuses a source whose vocabulary differs from the active edition", () => {
    const changed = vocabCsv((r) => ["1", r.id === 42 ? "别的词" : r.hanzi, r.pinyin, "", String(r.id), "x"]);
    const result = run({ "hsk_vocabulary.csv": changed });
    expect(codes(result)).toEqual(["VOCAB_MISMATCH"]);
    expect(result.ok ? "" : result.issues[0]?.message).toMatch(/entry 42/);
  });

  it("refuses a source with entries missing from its vocabulary", () => {
    const short = vocabCsv().split("\n").slice(0, -5).join("\n");
    expect(codes(run({ "hsk_vocabulary.csv": short }))).toEqual(["VOCAB_MISMATCH"]);
  });

  it("refuses to run before the vocabulary is imported", () => {
    expect(codes(run({}, []))).toEqual(["NO_VERIFIED_VOCAB"]);
  });

  it("names a missing file", () => {
    const result = run({ "hsk_topic.csv": "" });
    expect(codes(result)).toEqual(["MISSING_FILE"]);
    expect(result.ok ? "" : result.issues[0]?.message).toMatch(/hsk_topic\.csv/);
  });

  it("rejects bad rows, and writes nothing if any section has one", () => {
    expect(codes(run({ "hsk_hanzi.csv": hanziCsv("\nHSK8,八,1") }))).toEqual(["UNKNOWN_LEVEL"]);
    expect(codes(run({ "hsk_hanzi.csv": hanziCsv("\nHSK1,一二,1") }))).toEqual(["UNEXPECTED_VALUE"]);
    expect(codes(run({ "hsk_hanzi.csv": hanziCsv("\nHSK1,丁,3") }))).toEqual(["UNEXPECTED_VALUE"]);
    expect(codes(run({ "hsk_hanzi.csv": hanziCsv("\nHSK1,一,1") }))).toEqual(["DUPLICATE_ROW"]);
    expect(codes(run({ "hsk_task.csv": taskCsv("\nHSK1,[x],任务,能。") }))).toEqual(["UNEXPECTED_VALUE"]);
    expect(codes(run({ "hsk_grammar.csv": grammarCsv("\nHSK1,,词类,,,例。") }))).toEqual(["MISSING_FIELD"]);
    expect(codes(run({ "hsk_topic.csv": topicCsv().split("\n").filter((l) => !l.startsWith("HSK3,")).join("\n") }))).toEqual(["EMPTY_BAND"]);
    expect(codes(run({ "hsk_task.csv": "examLevelId,level1Content\nHSK1,x" }))).toEqual(["MISSING_COLUMN"]);
    expect(codes(run({ "hsk_grammar.csv": new TextDecoder().decode(new Uint8Array([0xff])) }))).not.toEqual([]);
  });
});

describe("storing the sections (FR-016)", () => {
  let database: TestDatabase;
  let query: QueryFn;

  beforeEach(async () => {
    database = await createTestDatabase();
    query = async (sql) => (await database.db.prepare(sql).all<Record<string, unknown>>()).results;
    const vocab = prepare([sourceFile("all.csv", toCsv(records))], SYNTHETIC_EDITION_ID);
    if (!vocab.ok) throw new Error("fixture rejected");
    await applyStatements(database.db, vocab.statements);
  });
  afterEach(async () => {
    await database.dispose();
  });

  async function importSections() {
    const result = run();
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    await applyStatements(database.db, result.statements);
  }

  it("stores each row with its type, band and details, marked unverified", async () => {
    await importSections();
    const [grammar] = await query(
      `SELECT id, hanzi, metadata_json FROM curriculum_items WHERE item_type = 'grammar' AND source_id = 8`,
    );
    expect(grammar?.id).toBe(`${SYNTHETIC_EDITION_ID}:grammar:8`);
    expect(grammar?.hanzi).toBe("样例陈述句");
    expect(JSON.parse(String(grammar?.metadata_json))).toEqual({
      grammarType: "句子的类型",
      category: "句类",
      detail: "样例陈述句",
      examples: ["样例句三。"],
    });
    const [first] = await query(`SELECT metadata_json FROM curriculum_items WHERE id = '${SYNTHETIC_EDITION_ID}:grammar:1'`);
    expect(JSON.parse(String(first?.metadata_json)).examples).toEqual(["样例句一。", "样例句二。"]);
    const [writing] = await query(`SELECT metadata_json FROM curriculum_items WHERE item_type = 'character' AND hanzi = '写'`);
    expect(JSON.parse(String(writing?.metadata_json))).toEqual({ skill: "writing" });

    const manifests = await query(`SELECT dataset_kind, verification_status FROM source_manifests WHERE dataset_kind <> 'vocab' ORDER BY dataset_kind`);
    expect(manifests.map((m) => m.dataset_kind)).toEqual(["character", "grammar", "task", "topic", "vocab-crosscheck"]);
    expect(new Set(manifests.map((m) => m.verification_status))).toEqual(new Set(["unverified"]));
    const [check] = await query(`SELECT record_count FROM source_manifests WHERE dataset_kind = 'vocab-crosscheck'`);
    expect(Number(check?.record_count)).toBe(11000);
  });

  it("leaves vocabulary verified and reports the new sections as imported, never verified", async () => {
    await importSections();
    const report = await verifyDatabase(query);
    expect(report.ok).toBe(true);
    expect(report.dimensions).toEqual([
      { itemType: "vocab", status: "verified", count: 11000 },
      { itemType: "grammar", status: "imported", count: 8 },
      { itemType: "character", status: "imported", count: 8 },
      { itemType: "topic", status: "imported", count: 7 },
      { itemType: "task", status: "imported", count: 7 },
    ]);

    const app = createApp();
    const res = await app.request("http://localhost/api/v1/curriculum/status", {}, { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });
    const status = curriculumStatusResponseSchema.parse(await res.json());
    expect(status.dimensions.find((d) => d.itemType === "grammar")).toMatchObject({ status: "imported", importedCount: 8, expectedCount: null });
  });

  it("can be run again without duplicating anything", async () => {
    await importSections();
    await importSections();
    const [row] = await query(`SELECT COUNT(*) AS n FROM curriculum_items WHERE item_type <> 'vocab'`);
    expect(Number(row?.n)).toBe(30);
    const [m] = await query(`SELECT COUNT(*) AS n FROM source_manifests WHERE dataset_kind <> 'vocab'`);
    expect(Number(m?.n)).toBe(5);
  });
});
