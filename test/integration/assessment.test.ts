import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { buildQuestions, scoreAnswer, type TestPools } from "../../src/server/services/assessment";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { assessmentListResponseSchema, assessmentResponseSchema, type Assessment } from "../../src/shared/assessment";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { syntheticSections } from "../fixtures/synthetic-sections";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and sections: not HSK content.
let database: TestDatabase;
const app = createApp();
const ENV = () => ({ DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });
const records = makeSyntheticRecords();

function send(method: string, path: string, body?: unknown) {
  return app.request(
    `http://localhost/api/v1${path}`,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    ENV(),
  );
}

async function start(band = "1", kind = "band_test"): Promise<Assessment> {
  const res = await send("POST", "/tests", { band, kind });
  expect(res.status, await res.clone().text()).toBe(201);
  return assessmentResponseSchema.parse(await res.json()).assessment;
}

/** The key of each question, read back from storage (the API never sends it before finishing). */
async function keys(id: string): Promise<(number | null)[]> {
  const row = await database.db.prepare("SELECT metadata_json FROM assessment_runs WHERE id = ?1").bind(id).first<{ metadata_json: string }>();
  return (JSON.parse(row?.metadata_json ?? "{}") as { questions: { key: number | null }[] }).questions.map((q) => q.key);
}

beforeAll(async () => {
  database = await createTestDatabase();
  const vocab = prepare([sourceFile("all.csv", toCsv(records))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
  await applyStatements(database.db, syntheticSections(records));
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  for (const t of ["assessment_runs", "practice_attempts", "mastery_states", "item_flags"]) await database.db.prepare(`DELETE FROM ${t}`).run();
});

describe("building a band test (SPEC §6.5, FR-027)", () => {
  const pools: TestPools = {
    words: Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, hanzi: `样例词${i}`, pinyin: `yàng ${i}` })),
    grammar: [
      { id: "g1", name: "是……的", examples: ["我是坐车来的。"], unverified: true },
      { id: "g2", name: "了", examples: ["我吃了饭。"], unverified: true },
      { id: "g3", name: "过", examples: ["我去过北京。"], unverified: true },
    ],
    characters: [{ id: "c1", hanzi: "样", unverified: true }],
    topic: "样例领域 · 样例主题",
    task: "能完成样例任务。",
  };

  it("is the same for the same seed and keeps every key among its options", () => {
    const a = buildQuestions(pools, "band_test", "seed");
    expect(buildQuestions(pools, "band_test", "seed")).toEqual(a);
    expect(a.map((q) => q.kind)).toEqual([
      ...Array(5).fill("word_reading"),
      ...Array(5).fill("word_listening"),
      "grammar_gap",
      "grammar_gap",
      "grammar_gap",
      "writing_task",
    ]);
    for (const q of a.filter((x) => x.key !== null)) {
      expect(q.options[q.key as number]).toBe(q.keyText);
      expect(new Set(q.options).size).toBe(q.options.length);
    }
    const gap = a.find((q) => q.kind === "grammar_gap");
    expect(gap?.prompt).toContain("＿＿");
    expect(gap?.unverifiedKey).toBe(true);
  });

  it("scores written tasks by length and band words, and choices by their key", () => {
    const [write] = buildQuestions(pools, "band_test", "s").filter((q) => q.kind === "writing_task");
    if (!write) throw new Error("no writing task");
    expect(scoreAnswer(write, "我今天学了样例词1和样例词2，我觉得很有意思，明天还要学。")).toBe(true);
    expect(scoreAnswer(write, "我今天很好。")).toBe(false);
    const choice = buildQuestions(pools, "band_test", "s")[0];
    if (!choice) throw new Error("no question");
    expect(scoreAnswer(choice, choice.key)).toBe(true);
  });

  it("adds a spontaneous speaking task to a checkpoint", () => {
    expect(buildQuestions(pools, "checkpoint", "s").some((q) => q.kind === "speaking_task")).toBe(true);
  });
});

describe("taking a test (SPEC §6.5, FR-027)", () => {
  it("withholds the keys, scores once, and reports per-section scores with sample sizes", async () => {
    const test = await start();
    expect(test.results).toBeNull();
    expect(JSON.stringify(test.questions)).not.toContain('"key"');
    const k = await keys(test.id);
    const answers = k.map((key, i) => (key === null ? "我今天学了样例词1和样例词2，觉得很有意思，明天还想学。" : i === 0 ? (key + 1) % 3 : key));
    const res = await send("POST", `/tests/${test.id}/answers`, { answers });
    const done = assessmentResponseSchema.parse(await res.json()).assessment;
    expect(done.results?.total).toBe(k.length);
    expect(done.results?.correct).toBe(k.length - 1);
    const reading = done.results?.sections.find((s) => s.kind === "word_reading");
    expect(reading).toMatchObject({ skill: "reading", total: 5, correct: 4 });
    // Asking again returns the first result.
    const again = assessmentResponseSchema.parse(await (await send("POST", `/tests/${test.id}/answers`, { answers: k.map(() => null) })).json()).assessment;
    expect(again.results?.correct).toBe(k.length - 1);
  });

  it("counts answers as recall evidence for the items asked about", async () => {
    const test = await start();
    const k = await keys(test.id);
    await send("POST", `/tests/${test.id}/answers`, { answers: k.map((key) => key ?? null) });
    const attempts = await database.db.prepare("SELECT COUNT(*) AS n FROM practice_attempts WHERE assessment_type = 'band_test' AND is_qualifying_recall = 1").first<{ n: number }>();
    expect(attempts?.n).toBe(k.filter((x) => x !== null).length);
    const states = await database.db.prepare("SELECT COUNT(*) AS n FROM mastery_states WHERE state = 'developing'").first<{ n: number }>();
    expect(states?.n).toBeGreaterThan(0);
  });

  it("leaves flagged grammar out of its keys", async () => {
    await send("POST", `/curriculum/items/${encodeURIComponent("synthetic-fixture:grammar:1")}/flag`, {});
    const test = await start();
    const row = await database.db.prepare("SELECT metadata_json FROM assessment_runs WHERE id = ?1").bind(test.id).first<{ metadata_json: string }>();
    expect(row?.metadata_json).not.toContain("synthetic-fixture:grammar:1");
  });

  it("allows one checkpoint a month, on words not met before, with a speaking task", async () => {
    let list = assessmentListResponseSchema.parse(await (await send("GET", "/tests")).json());
    expect(list.checkpointDue).toBe(true);
    const cp = await start("1", "checkpoint");
    expect(cp.questions.some((q) => q.kind === "speaking_task")).toBe(true);
    list = assessmentListResponseSchema.parse(await (await send("GET", "/tests")).json());
    expect(list.checkpointDue).toBe(false);
    expect((await send("POST", "/tests", { band: "1", kind: "checkpoint" })).status).toBe(409);
  });

  it("records a typed answer to a spoken task as writing, and a spoken one as speaking", async () => {
    const cp = await start("1", "checkpoint");
    const k = await keys(cp.id);
    const speak = cp.questions.findIndex((q) => q.kind === "speaking_task");
    const answers = k.map((key, i) => (i === speak ? "我今天学了样例词1，觉得很有意思。" : key));
    await send("POST", `/tests/${cp.id}/answers`, { answers, spoken: k.map(() => false) });
    const skills = await database.db.prepare("SELECT DISTINCT skill FROM practice_attempts WHERE assessment_type = 'checkpoint' AND user_response LIKE '%有意思%'").all<{ skill: string }>();
    expect(skills.results.map((s) => s.skill)).toEqual(["writing"]);
  });
});

describe("sampling the whole band (SPEC §2.6 rule 7, FR-038)", () => {
  it("draws words from across the band, not only the start of its list", async () => {
    const test = await start("7-9");
    const row = await database.db.prepare("SELECT metadata_json FROM assessment_runs WHERE id = ?1").bind(test.id).first<{ metadata_json: string }>();
    const seen = new Set<number>();
    for (const q of (JSON.parse(row?.metadata_json ?? "{}") as { questions: { itemId: string | null }[] }).questions) {
      if (q.itemId?.includes(":vocab:")) seen.add(Number(q.itemId.split(":").pop()));
    }
    const ids = [...seen];
    // Band 7-9 is entries 5401-11000; the first 400 end at 5800.
    expect(ids.some((n) => n > 5800)).toBe(true);
  });
});

describe("placement and promotion (SPEC §2.6 rule 6, FR-037)", () => {
  it("asks the same number of words from every band, estimates size and suggests a band, without recording recall", async () => {
    const test = await start("1", "placement");
    expect(test.kind).toBe("placement");
    const row = await database.db.prepare("SELECT metadata_json FROM assessment_runs WHERE id = ?1").bind(test.id).first<{ metadata_json: string }>();
    const qs = (JSON.parse(row?.metadata_json ?? "{}") as { questions: { band: string; key: number }[] }).questions;
    const perBand = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7-9"].map((b) => [b, qs.filter((q) => q.band === b).length]));
    expect(perBand).toEqual({ "1": 6, "2": 6, "3": 6, "4": 6, "5": 6, "6": 6, "7-9": 6 });
    // Right on bands 1 and 2, wrong after.
    const answers = qs.map((q) => (q.band === "1" || q.band === "2" ? q.key : (q.key + 1) % 3));
    const done = assessmentResponseSchema.parse(await (await send("POST", `/tests/${test.id}/answers`, { answers })).json()).assessment;
    expect(done.results?.placement).toMatchObject({ suggestedBand: "3", sampleSize: 42, estimatedWords: 500 });
    expect(done.results?.placement?.bands[0]).toMatchObject({ band: "1", correct: 6, total: 6, known: 1 });
    const attempts = await database.db.prepare("SELECT COUNT(*) AS n FROM practice_attempts").first<{ n: number }>();
    expect(attempts?.n).toBe(0);
  });

  it("suggests the next band only when most of this one is recalled and its test is passed twice", async () => {
    const promo = async () => (await (await send("GET", "/tests/promotion")).json()) as { promotion: { ready: boolean; recalled: number; testPasses: number; next: string } };
    let p = await promo();
    expect(p.promotion).toMatchObject({ ready: false, recalled: 0, testPasses: 0, next: "2" });
    await database.db
      .prepare("INSERT INTO mastery_states (owner_id, curriculum_item_id, skill, state, first_seen_at, updated_at) SELECT 'owner', id, 'reading', 'developing', '2026-11-01', '2026-11-01' FROM curriculum_items WHERE item_type = 'vocab' AND hsk_band = '1' ORDER BY source_id LIMIT 250")
      .run();
    for (let i = 0; i < 2; i++) {
      const t = await start("1");
      const k = await keys(t.id);
      await send("POST", `/tests/${t.id}/answers`, { answers: k.map((x) => x ?? "我今天学了样例词1和样例词2，觉得很有意思，明天还想学。") });
      await database.db.prepare("UPDATE assessment_runs SET started_at = '2000-01-01' WHERE id = ?1").bind(t.id).run();
    }
    p = await promo();
    expect(p.promotion).toMatchObject({ ready: true, testPasses: 2 });
    expect(p.promotion.recalled).toBeGreaterThanOrEqual(250);
  });
});

describe("word questions on meaning (SPEC §2.6 rule 7, FR-038)", () => {
  it("asks for the meaning when sourced meanings exist", () => {
    const words = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, hanzi: `样例词${i}`, pinyin: `yàng ${i}`, meaning: `meaning ${i}` }));
    const [q] = buildQuestions({ words, grammar: [], characters: [], topic: null, task: null }, "band_test", "m");
    expect(q?.ask).toBe("Choose the meaning of this word.");
    expect(q?.options.every((o) => o.startsWith("meaning "))).toBe(true);
  });
});
