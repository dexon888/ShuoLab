import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { progressSummarySchema } from "../../src/shared/progress";
import { dueResponseSchema, rateResponseSchema, type ReviewCard } from "../../src/shared/review";
import { planResponseSchema, type SessionDetail } from "../../src/shared/session";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { syntheticSections } from "../fixtures/synthetic-sections";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and sections, and the local stand-in tutor: no model is called.
let database: TestDatabase;
let tutor: FakeTutorProvider;
const app = createApp({ tutor: () => tutor });
const ENV = () => ({ DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });
const records = makeSyntheticRecords();

function send(method: string, path: string, body?: unknown) {
  return app.request(
    `http://localhost/api/v1${path}`,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    ENV(),
  );
}

async function finishedSession(transcripts: string[] = ["你好。"]): Promise<SessionDetail> {
  const res = await send("POST", "/sessions/plan", { durationMinutes: 20, studyBand: "1" });
  const { session } = planResponseSchema.parse(await res.json());
  for (const transcript of transcripts) {
    await send("POST", `/sessions/${session.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript, sourceMode: "typed", asrUncertain: false });
  }
  const done = await send("POST", `/sessions/${session.id}/complete`, {});
  expect(done.status, await done.clone().text()).toBe(200);
  return session;
}

async function due(): Promise<ReviewCard[]> {
  return dueResponseSchema.parse(await (await send("GET", "/reviews/due?limit=50")).json()).cards;
}

async function rate(card: ReviewCard, rating: string, answer?: string) {
  const res = await send("POST", `/reviews/${card.id}/rate`, { rating, clientEventId: crypto.randomUUID(), ...(answer ? { answer } : {}) });
  expect([200, 201], await res.clone().text()).toContain(res.status);
  return rateResponseSchema.parse(await res.json());
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
  tutor = new FakeTutorProvider();
  for (const table of ["usage_events", "review_events", "practice_attempts", "mastery_states", "review_cards", "sessions"]) {
    await database.db.prepare(`DELETE FROM ${table}`).run();
  }
});

describe("cards for grammar and characters (SPEC §5.5, FR-025)", () => {
  it("gives a finished session's grammar point four cards and its characters a recognition card, plus a typing card on a writing list", async () => {
    const session = await finishedSession();
    const cards = await due();
    const grammarId = session.plan.grammar[0]?.itemId;
    const byItem = (id: string | undefined) => cards.filter((c) => c.item.id === id).map((c) => c.template).sort();
    expect(byItem(grammarId)).toEqual(["grammar_listen", "grammar_read", "grammar_say", "grammar_write"]);
    const chars = session.plan.characters;
    const write = chars.find((c) => c.skill === "writing");
    const read = chars.find((c) => c.skill === "recognition");
    expect(byItem(write?.itemId)).toEqual(["char_recognise", "char_type"]);
    expect(byItem(read?.itemId)).toEqual(["char_recognise"]);
    // Words start with recognition only.
    expect(byItem(session.plan.targets[0]?.itemId)).toEqual(["audio_to_meaning", "hanzi_to_meaning"]);
  });

  it("shows a grammar card's syllabus example and a character card's words, labelled unverified", async () => {
    const session = await finishedSession();
    const cards = await due();
    const grammar = cards.find((c) => c.template === "grammar_read");
    expect(grammar?.item).toMatchObject({ itemType: "grammar", hanzi: "是……的", example: "我是坐车来的。", unverified: true });
    const char = cards.find((c) => c.template === "char_recognise" && c.item.hanzi === "样");
    expect(char?.item.itemType).toBe("character");
    expect(char?.item.words.length).toBeGreaterThan(0);
    expect(char?.item.words.every((w) => w.hanzi.includes("样"))).toBe(true);
    expect(session.plan.targets.some((t) => char?.item.words.some((w) => w.hanzi === t.hanzi))).toBe(true);
  });

  it("adds a word's speaking and writing cards after its first recall, due a day later", async () => {
    const session = await finishedSession();
    const word = session.plan.targets[0]?.itemId;
    const reading = (await due()).find((c) => c.item.id === word && c.template === "hanzi_to_meaning");
    if (!reading) throw new Error("no card");
    await rate(reading, "again");
    let templates = (await database.db.prepare("SELECT template FROM review_cards WHERE curriculum_item_id = ?1").bind(word).all<{ template: string }>()).results;
    expect(templates.map((t) => t.template).sort()).toEqual(["audio_to_meaning", "hanzi_to_meaning"]);
    await rate((await due()).find((c) => c.item.id === word && c.template === "hanzi_to_meaning") ?? reading, "good");
    templates = (await database.db.prepare("SELECT template FROM review_cards WHERE curriculum_item_id = ?1").bind(word).all<{ template: string }>()).results;
    expect(templates.map((t) => t.template).sort()).toEqual(["audio_to_meaning", "hanzi_to_meaning", "word_say", "word_write"]);
    expect((await due()).some((c) => c.item.id === word && c.template === "word_say")).toBe(false);
  });

  it("keeps a typed answer with the rating, and only production cards move speaking and writing", async () => {
    const session = await finishedSession();
    const grammarId = session.plan.grammar[0]?.itemId;
    const cards = await due();
    const read = cards.find((c) => c.item.id === grammarId && c.template === "grammar_read");
    const write = cards.find((c) => c.item.id === grammarId && c.template === "grammar_write");
    if (!read || !write) throw new Error("no cards");
    await rate(read, "good");
    const states = async () =>
      Object.fromEntries(
        (await database.db.prepare("SELECT skill, state FROM mastery_states WHERE curriculum_item_id = ?1").bind(grammarId).all<{ skill: string; state: string }>()).results.map((r) => [r.skill, r.state]),
      );
    expect(await states()).toMatchObject({ reading: "developing", writing: "introduced", speaking: "introduced" });
    await rate(write, "good", "我是走路来的。");
    expect(await states()).toMatchObject({ writing: "developing" });
    const attempt = await database.db
      .prepare("SELECT user_response FROM practice_attempts WHERE curriculum_item_id = ?1 AND skill = 'writing' AND assessment_type = 'review_self_rating'")
      .bind(grammarId)
      .first<{ user_response: string }>();
    expect(attempt?.user_response).toBe("我是走路来的。");
  });
});

describe("feedback flows forward (SPEC §2.5 rule 7, FR-029)", () => {
  function correcting(original: string, corrected: string) {
    return new FakeTutorProvider({
      respond: () =>
        JSON.stringify({
          spoken_reply_zh: "好的，我明白了。你呢？",
          optional_pinyin: null,
          optional_translation_en: null,
          referenced_curriculum_item_ids: [],
          referenced_colloquial_ids: [],
          used_grammar_ids: [],
          elicited_grammar_ids: [],
          semantic_feedback: { understood_intent: true, corrections: [{ original, corrected, note_en: null }], encouragement_zh: null },
          suggested_followup_topic: null,
        }),
    });
  }

  it("makes the cards of corrected words and grammar due now, and puts them first in the next plan", async () => {
    const first = await (async () => {
      const res = await send("POST", "/sessions/plan", { durationMinutes: 20, studyBand: "1" });
      return planResponseSchema.parse(await res.json()).session;
    })();
    const word = first.plan.targets[2];
    if (!word) throw new Error("no word");
    tutor = correcting(`我坐车来`, `我是坐车来的，还有${word.hanzi}`);
    await send("POST", `/sessions/${first.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript: "我坐车来。", sourceMode: "typed", asrUncertain: false });
    await send("POST", `/sessions/${first.id}/complete`, {});

    // The next day, those come first: the word as review, the grammar point recycled.
    await database.db.prepare("UPDATE sessions SET local_study_date = date(local_study_date, '-1 day')").run();
    const res = await send("POST", "/sessions/plan", { durationMinutes: 20, studyBand: "1" });
    const next = planResponseSchema.parse(await res.json()).session;
    expect(next.plan.targets.find((t) => t.role === "review")?.itemId).toBe(word.itemId);
    expect(next.plan.grammar[0]).toMatchObject({ itemId: first.plan.grammar[0]?.itemId, role: "recycled" });
  });
});

describe("section progress (SPEC §5.6, §8.3, FR-026)", () => {
  it("reports grammar and characters per band against imported rows, labelled unverified, with topics and tasks as exposure", async () => {
    const session = await finishedSession();
    const read = (await due()).find((c) => c.template === "grammar_read");
    if (read) await rate(read, "good");
    const p = progressSummarySchema.parse(await (await send("GET", "/progress/summary?days=7")).json());
    expect(p.sections.grammar?.unverified).toBe(true);
    const band1 = p.sections.grammar?.bands.find((b) => b.band === "1");
    expect(band1).toMatchObject({ entries: 3, introduced: 1 });
    expect(band1?.bySkill.reading.developing).toBe(1);
    expect(p.sections.character?.total.introduced).toBe(session.plan.characters.length);
    expect(p.sections.tasks).toMatchObject({ met: 1 });
    expect(p.sections.topics.imported).toBeGreaterThan(1);
    // Verified vocabulary coverage is untouched by section rows.
    expect(p.hsk.total.entries).toBe(11000);
  });

  it("counts meaningful days only with both production and retrieval, and reports skill balance", async () => {
    await finishedSession(["我今天很好。"]);
    let p = progressSummarySchema.parse(await (await send("GET", "/progress/summary?days=7")).json());
    expect(p.meaningfulDays.count).toBe(0);
    const card = (await due())[0];
    if (card) await rate(card, "good");
    p = progressSummarySchema.parse(await (await send("GET", "/progress/summary?days=7")).json());
    expect(p.meaningfulDays.count).toBe(1);
    expect(p.skillBalance.map((s) => s.skill)).toEqual(["listening", "speaking", "reading", "writing"]);
    expect(p.skillBalance.reduce((n, s) => n + s.attempts, 0)).toBeGreaterThan(0);
  });
});
