import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { sessionStateResponseSchema } from "../../src/shared/debrief";
import { materialsResponseSchema } from "../../src/shared/lesson";
import { listeningResponseSchema } from "../../src/shared/listening";
import { planResponseSchema, type SessionDetail } from "../../src/shared/session";
import { turnResponseSchema } from "../../src/shared/tutor";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";
import { syntheticSections } from "../fixtures/synthetic-sections";

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

async function json<T>(res: Response, schema: { parse: (v: unknown) => T }, status = [200, 201]): Promise<T> {
  expect(status, await res.clone().text()).toContain(res.status);
  return schema.parse(await res.json());
}

async function plan(minutes = 20): Promise<SessionDetail> {
  await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE status IN ('planned','active','paused')").run();
  return (await json(await send("POST", "/sessions/plan", { durationMinutes: minutes, studyBand: "1" }), planResponseSchema)).session;
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
  await database.db.prepare("DELETE FROM usage_events").run();
  await database.db.prepare("DELETE FROM sessions").run();
});

describe("a connected plan (SPEC §2.4, §2.5, §6.2)", () => {
  it("targets checkable grammar, the words' characters, a topic and a task, and stores them as the session's items", async () => {
    const session = await plan(20);
    const p = session.plan;
    expect(p.version).toBe(2);
    expect(p.grammar.map((g) => [g.name, g.role, g.unverified])).toEqual([["是……的", "new", true]]);
    expect(p.grammar[0]?.example).toBe("我是坐车来的。");
    // Characters of the target words that are on the band's lists, each shown in its word.
    expect(p.characters.map((c) => [c.hanzi, c.skill])).toEqual([
      ["样", "recognition"],
      ["例", "writing"],
      ["词", "recognition"],
    ]);
    expect(p.characters[0]?.word).toMatch(/^样例词/);
    expect(p.topic?.subject).toBe("样例主题甲");
    expect(p.task?.canDo).toBe("能完成样例任务甲。");
    expect(p.situation).toMatchObject({ sourceType: "syllabus", communicativeGoal: "能完成样例任务甲。" });
    expect(p.activities.map((a) => a.kind)).toEqual(["warmup", "introduce", "listen", "notice", "read", "practice", "speak", "write", "summary"]);

    const items = await database.db
      .prepare("SELECT item_type, role FROM session_items WHERE session_id = ?1 ORDER BY position")
      .bind(session.id)
      .all<{ item_type: string; role: string }>();
    expect(items.results.map((r) => r.item_type)).toEqual(["grammar", "character", "character", "character", "topic", "task"]);
  });

  it("never picks a grammar point whose pattern cannot be checked, and only one in 15 minutes", async () => {
    const session = await plan(15);
    expect(session.plan.grammar).toHaveLength(1);
    expect(session.plan.grammar.some((g) => g.name.includes("陈述句"))).toBe(false);
  });

  it("moves to the next task and topic in the next session", async () => {
    const first = await plan(20);
    const second = await plan(20);
    expect(second.plan.task?.itemId).not.toBe(first.plan.task?.itemId);
  });
});

describe("the spine's material (SPEC §5.3)", () => {
  it("writes a listening exchange that contains the grammar pattern and the new words", async () => {
    const session = await plan(20);
    const { exercise } = await json(await send("POST", `/sessions/${session.id}/listening`, {}), listeningResponseSchema);
    const text = exercise.lines.map((l) => l.zh).join("");
    expect(text).toContain("是坐车来的");
    expect(exercise.coversTargets).toBe(true);
    const req = tutor.requests.at(-1);
    expect(req?.instructions).toContain("是……的");
    expect(req?.instructions).toContain("能完成样例任务");
  });

  it("writes reading, practice and writing once, withholding answers until checked", async () => {
    const session = await plan(20);
    const created = await json(await send("POST", `/sessions/${session.id}/materials`, {}), materialsResponseSchema, [201]);
    const m = created.materials;
    expect(m.coversTargets).toBe(true);
    expect(m.reading.lines.map((l) => l.zh).join("")).toContain("是坐车来的");
    expect(m.reading.questions.every((q) => q.answerIndex === null)).toBe(true);
    expect(m.practice.length).toBeGreaterThanOrEqual(2);
    expect(m.practice.every((p) => p.modelAnswerZh === null)).toBe(true);
    expect(m.writing.criteria.map((c) => c.label)).toEqual(["Uses 是……的", "Uses at least 2 of today's words", "At least 15 Chinese characters"]);

    const again = await json(await send("POST", `/sessions/${session.id}/materials`, {}), materialsResponseSchema, [200]);
    expect(again.materials.reading.lines).toEqual(m.reading.lines);
    expect(tutor.requests.filter((r) => r.format?.name === "lesson_materials")).toHaveLength(1);
  });

  it("checks guided practice by the pattern and records spoken and typed answers as different skills", async () => {
    const session = await plan(20);
    await send("POST", `/sessions/${session.id}/materials`, {});
    const ok = await json(
      await send("POST", `/sessions/${session.id}/materials/practice`, { index: 0, answer: "我是坐飞机来的。", mode: "spoken" }),
      materialsResponseSchema,
    );
    expect(ok.materials.practice[0]?.result).toMatchObject({ passed: true, mode: "spoken" });
    expect(ok.materials.practice[0]?.modelAnswerZh).toBe("我是坐车来的。");
    const miss = await json(
      await send("POST", `/sessions/${session.id}/materials/practice`, { index: 0, answer: "我坐飞机来。", mode: "typed" }),
      materialsResponseSchema,
    );
    expect(miss.materials.practice[0]?.result?.checks).toEqual([
      { id: `grammar:${session.plan.grammar[0]?.itemId}`, label: "Uses 是……的", met: false },
      { id: "chinese", label: "Answers in Chinese", met: true },
    ]);
    const attempts = await database.db
      .prepare("SELECT skill, success FROM practice_attempts WHERE session_id = ?1 AND assessment_type = 'guided_practice' ORDER BY attempted_at, rowid")
      .bind(session.id)
      .all<{ skill: string; success: number }>();
    expect(attempts.results).toEqual([
      { skill: "speaking", success: 1 },
      { skill: "writing", success: 0 },
    ]);
  });

  it("checks the writing by fixed criteria and records evidence for the grammar and the words used", async () => {
    const session = await plan(20);
    await send("POST", `/sessions/${session.id}/materials`, {});
    const [w1, w2] = session.plan.targets.map((t) => t.hanzi);
    const answer = `我是昨天坐车来的。我学了${w1}和${w2}，很有意思。`;
    const res = await json(await send("POST", `/sessions/${session.id}/materials/writing`, { answer }), materialsResponseSchema);
    expect(res.materials.writing.result).toMatchObject({ passed: true, answer });
    const attempts = await database.db
      .prepare("SELECT COUNT(*) AS n FROM practice_attempts WHERE session_id = ?1 AND assessment_type = 'writing_task' AND success = 1")
      .bind(session.id)
      .first<{ n: number }>();
    expect(attempts?.n).toBe(3);
  });

  it("scores the reading only as unassisted when answered before the translation", async () => {
    const session = await plan(20);
    const { materials } = await json(await send("POST", `/sessions/${session.id}/materials`, {}), materialsResponseSchema);
    await send("POST", `/sessions/${session.id}/materials/reading/reveal`, {});
    const right = materials.reading.questions.map((q) => q.optionsEn.indexOf("Today's words"));
    const res = await json(await send("POST", `/sessions/${session.id}/materials/reading/answers`, { answers: right }), materialsResponseSchema);
    expect(res.materials.reading).toMatchObject({ correct: 1, revealed: true, unassisted: false });
  });

  it("includes the materials in the session state", async () => {
    const session = await plan(20);
    await send("POST", `/sessions/${session.id}/materials`, {});
    const state = sessionStateResponseSchema.parse(await (await send("GET", `/sessions/${session.id}`)).json());
    expect(state.materials?.sessionId).toBe(session.id);
  });
});

describe("grammar in the conversation (SPEC §6.3)", () => {
  const turn = (id: string, transcript: string) =>
    send("POST", `/sessions/${id}/turn`, { clientTurnId: crypto.randomUUID(), transcript, sourceMode: "typed", asrUncertain: false });

  it("keeps the tutor's grammar claims only when the pattern is in the reply, and records the learner's own use", async () => {
    const session = await plan(20);
    const first = await json(await turn(session.id, "你好，我是坐地铁来的。"), turnResponseSchema);
    expect(first.turn.grammarUsedIds).toEqual([session.plan.grammar[0]?.itemId]);
    expect(first.turn.learnerGrammarIds).toEqual([session.plan.grammar[0]?.itemId]);

    tutor = new FakeTutorProvider({
      respond: () =>
        JSON.stringify({
          spoken_reply_zh: "好的，你今天忙吗？",
          optional_pinyin: null,
          optional_translation_en: null,
          referenced_curriculum_item_ids: [],
          referenced_colloquial_ids: [],
          used_grammar_ids: [session.plan.grammar[0]?.itemId, "invented:grammar:1"],
          elicited_grammar_ids: [],
          semantic_feedback: { understood_intent: true, corrections: [], encouragement_zh: null },
          suggested_followup_topic: null,
        }),
    });
    const second = await json(await turn(session.id, "我很好。"), turnResponseSchema);
    expect(second.turn.grammarUsedIds).toEqual([]);
    const evidence = await database.db
      .prepare("SELECT COUNT(*) AS n FROM practice_attempts WHERE session_id = ?1 AND assessment_type = 'conversation_use'")
      .bind(session.id)
      .first<{ n: number }>();
    expect(evidence?.n).toBe(1);
  });

  it("requires the tutor to elicit a point nobody has used by the learner's 4th turn", async () => {
    const session = await plan(20);
    tutor = new FakeTutorProvider({
      respond: (req) =>
        JSON.stringify({
          spoken_reply_zh: req.context.mustElicit?.length ? "你是怎么来的？" : "好的，我知道了。你呢？",
          optional_pinyin: null,
          optional_translation_en: null,
          referenced_curriculum_item_ids: [],
          referenced_colloquial_ids: [],
          used_grammar_ids: [],
          elicited_grammar_ids: req.context.mustElicit ?? [],
          semantic_feedback: { understood_intent: true, corrections: [], encouragement_zh: null },
          suggested_followup_topic: null,
        }),
    });
    for (let i = 0; i < 3; i++) await json(await turn(session.id, "我很好。"), turnResponseSchema);
    expect(tutor.requests.every((r) => !r.instructions.includes("must end with a question"))).toBe(true);
    const fourth = await json(await turn(session.id, "我很好。"), turnResponseSchema);
    expect(tutor.requests.at(-1)?.instructions).toContain("must end with a question");
    expect(fourth.turn.grammarElicitedIds).toEqual([session.plan.grammar[0]?.itemId]);
    // Once invited, it is not demanded again.
    await json(await turn(session.id, "我很好。"), turnResponseSchema);
    expect(tutor.requests.at(-1)?.instructions).not.toContain("must end with a question");
  });
});

describe("words that belong with the task (SPEC §2.6 rule 3, FR-034)", () => {
  it("takes the new words the task and topic mention before syllabus order", async () => {
    // Make the first task of the band mention two words from far down the list.
    await database.db
      .prepare("UPDATE curriculum_items SET metadata_json = json_set(metadata_json, '$.canDo', '能用样例词201和样例词250完成样例任务。') WHERE item_type = 'task' AND hsk_band = '1' AND hanzi = '样例任务甲'")
      .run();
    const session = await plan(20);
    const words = session.plan.targets.filter((t) => t.role === "active").map((t) => t.hanzi);
    expect(words.slice(0, 2).sort()).toEqual(["样例词201", "样例词250"]);
    expect(session.plan.task?.canDo).toContain("样例词201");
  });
});
