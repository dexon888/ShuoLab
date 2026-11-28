import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider, fakeStoryOutput } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { glossStatements, matchGlosses, parseCedict } from "../../src/server/services/dictionary";
import { SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import { storyListResponseSchema, storyResponseSchema } from "../../src/shared/stories";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and the local stand-in tutor: not HSK content.
let database: TestDatabase;
let tutor: FakeTutorProvider;
const app = createApp({ tutor: () => tutor });
const send = (method: string, path: string, body?: unknown) =>
  app.request(`http://localhost/api/v1${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });
const records = makeSyntheticRecords();

async function newStory(kind = "story") {
  const res = await send("POST", "/stories", { kind });
  expect(res.status, await res.clone().text()).toBe(201);
  return storyResponseSchema.parse(await res.json()).story;
}

beforeAll(async () => {
  database = await createTestDatabase();
  const vocab = prepare([sourceFile("all.csv", toCsv(records))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
  // Words the learner has met, and a placeholder meaning for the first.
  await database.db
    .prepare("INSERT INTO mastery_states (owner_id, curriculum_item_id, skill, state, first_seen_at, updated_at) SELECT 'owner', id, 'reading', 'introduced', '2026-11-01', '2026-11-01' FROM curriculum_items WHERE item_type='vocab' ORDER BY source_id LIMIT 5")
    .run();
  const rows = records.slice(0, 5).map((r) => ({ id: `${SYNTHETIC_EDITION_ID}:vocab:${r.id}`, hanzi: r.hanzi, pinyin: r.pinyin }));
  const m = matchGlosses(rows, parseCedict(records.slice(0, 5).map((r) => `${r.hanzi} ${r.hanzi} [yang4] /placeholder meaning/`).join("\n")).entries);
  await applyStatements(database.db, glossStatements(SYNTHETIC_EDITION_ID, m.glosses, { name: "x.u8", sha256: "b".repeat(64) }, "2026-11-27T00:00:00.000Z"));
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  tutor = new FakeTutorProvider();
  await database.db.prepare("DELETE FROM stories").run();
  await database.db.prepare("DELETE FROM usage_events").run();
});

describe("graded stories (SPEC §5.10, FR-036)", () => {
  it("writes a story from the known words, stores its coverage, and hides pinyin, translation and answers at first", async () => {
    const story = await newStory();
    const instructions = tutor.requests[0]?.instructions ?? "";
    expect(instructions).toContain(records[0]?.hanzi ?? "?");
    expect(story).toMatchObject({ kind: "story", episode: 1, band: "1", standIn: true, revealed: false, answers: null });
    expect(story.coverage.total).toBeGreaterThan(0);
    expect(story.lines.every((l) => l.pinyin === "" && l.en === "")).toBe(true);
    expect(story.questions.every((q) => q.answerIndex === null)).toBe(true);
  });

  it("glosses the syllabus words in it, with the meaning's source", async () => {
    const story = await newStory();
    const glossed = Object.values(story.glossary).filter((g) => g.definition);
    expect(glossed.length).toBeGreaterThan(0);
    expect(glossed.every((g) => g.definition === "placeholder meaning" && /CC-CEDICT/.test(g.provenance ?? ""))).toBe(true);
  });

  it("continues the series, scores answers before the translation, and logs reading time", async () => {
    await newStory();
    const second = await newStory();
    expect(second.episode).toBe(2);
    expect(tutor.requests[1]?.instructions).toContain("Continue the previous episode");
    const right = second.questions.map((q) => q.optionsEn.findIndex((o) => o === "A word" || o === "Today"));
    let s = storyResponseSchema.parse(await (await send("POST", `/stories/${second.id}/answers`, { answers: right })).json()).story;
    expect(s).toMatchObject({ correct: 2, unassisted: true });
    s = storyResponseSchema.parse(await (await send("POST", `/stories/${second.id}/reveal`, {})).json()).story;
    expect(s.lines[0]?.en).toMatch(/stand-in/);
    s = storyResponseSchema.parse(await (await send("POST", `/stories/${second.id}/finish`, { minutes: 6.5 })).json()).story;
    expect(s.minutes).toBe(6.5);
    const list = storyListResponseSchema.parse(await (await send("GET", "/stories")).json());
    expect(list.minutesThisWeek).toBe(6.5);
    expect(list.stories.map((x) => x.episode)).toEqual([2, 1]);
  });

  it("asks once for a simpler story when it falls below the target, once 100 words are known", async () => {
    await database.db
      .prepare("INSERT OR IGNORE INTO mastery_states (owner_id, curriculum_item_id, skill, state, first_seen_at, updated_at) SELECT 'owner', id, 'reading', 'introduced', '2026-11-01', '2026-11-01' FROM curriculum_items WHERE item_type='vocab' ORDER BY source_id LIMIT 150")
      .run();
    let n = 0;
    tutor = new FakeTutorProvider({
      respond: (req) => {
        const base = fakeStoryOutput(req);
        n += 1;
        return JSON.stringify(n === 1 ? { ...base, lines: base.lines.map((l) => ({ ...l, zh: "鹦鹉螺号潜艇浮出水面。" })) } : base);
      },
    });
    Object.defineProperty(tutor, "mock", { value: false });
    const story = await newStory();
    expect(tutor.requests).toHaveLength(2);
    expect(tutor.requests[1]?.instructions).toMatch(/Rewrite it more simply\. Avoid: .*鹦/);
    expect(story.coverage.known).toBeGreaterThan(0);
  });
});
