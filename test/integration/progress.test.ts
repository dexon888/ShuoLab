import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { getProgressSummary, windowDates } from "../../src/server/services/progress";
import { listDue, rateCard } from "../../src/server/services/review";
import { curriculumItemDetailResponseSchema, curriculumItemsResponseSchema } from "../../src/shared/api";
import { listeningResponseSchema } from "../../src/shared/listening";
import { progressSummarySchema } from "../../src/shared/progress";
import { planResponseSchema, type SessionDetail } from "../../src/shared/session";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and the local stand-in tutor.
let database: TestDatabase;
const app = createApp({ tutor: () => new FakeTutorProvider() });
const ENV = () => ({ DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });

function send(method: string, path: string, body?: unknown) {
  return app.request(
    `http://localhost/api/v1${path}`,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    ENV(),
  );
}

async function plan(body: Record<string, unknown> = { durationMinutes: 30, studyBand: "2" }): Promise<SessionDetail> {
  await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE status IN ('planned','active','paused')").run();
  return planResponseSchema.parse(await (await send("POST", "/sessions/plan", body)).json()).session;
}

async function talk(id: string, sourceMode: "typed" | "speech" = "typed") {
  const res = await send("POST", `/sessions/${id}/turn`, { clientTurnId: crypto.randomUUID(), transcript: "你好。", sourceMode });
  expect(res.status).toBe(201);
}

async function summary(days = 30) {
  const res = await send("GET", `/progress/summary?days=${days}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return progressSummarySchema.parse(await res.json());
}

const items = async (query: string) => curriculumItemsResponseSchema.parse(await (await send("GET", `/curriculum/items?${query}`)).json());

beforeAll(async () => {
  database = await createTestDatabase();
  const vocab = prepare([sourceFile("all.csv", toCsv(makeSyntheticRecords()))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
  await send("PUT", "/settings", { timezone: "UTC" });
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  await database.db.batch(
    ["review_cards", "practice_attempts", "mastery_states", "listening_exercises", "conversation_turns", "session_targets", "sessions"].map((t) =>
      database.db.prepare(`DELETE FROM ${t}`),
    ),
  );
});

describe("the progress summary (SPEC §5.6)", () => {
  it("starts empty, with every band's denominator and no rates", async () => {
    const s = await summary();
    expect(s.window.days).toBe(30);
    expect(s.practice.days).toHaveLength(30);
    expect(s.practice.totalMinutes).toBe(0);
    expect(s.listening).toMatchObject({ checks: 0, accuracy: null });
    expect(s.reviews).toMatchObject({ ratings: 0, recallRate: null, averageRating: null });
    expect(s.hsk.synthetic).toBe(true);
    expect(s.hsk.total.entries).toBe(11000);
    expect(s.hsk.bands.map((b) => [b.band, b.entries, b.expectedEntries])).toEqual([
      ["1", 300, 300],
      ["2", 200, 200],
      ["3", 500, 500],
      ["4", 1000, 1000],
      ["5", 1600, 1600],
      ["6", 1800, 1800],
      ["7-9", 5600, 5600],
    ]);
    expect(s.hsk.total.introduced).toBe(0);
  });

  it("counts finished sessions, spoken and typed turns, and introduced words without calling them known", async () => {
    const session = await plan();
    await talk(session.id, "speech");
    await talk(session.id, "typed");
    await send("POST", `/sessions/${session.id}/complete`, {});

    const s = await summary();
    expect(s.practice.sessionsCompleted).toBe(1);
    expect(s.speaking).toEqual({ spokenTurns: 1, typedTurns: 1, sessionsWithSpeech: 1 });
    const counted = session.plan.targets.filter((t) => t.role !== "stretch");
    expect(s.hsk.total.introduced).toBe(counted.length);
    expect(s.hsk.total.bySkill.reading).toEqual({ introduced: counted.length, practiced: 0, developing: 0, mastered: 0 });
    expect(s.hsk.total.bySkill.speaking).toEqual({ introduced: 0, practiced: 0, developing: 0, mastered: 0 });
    expect(s.hsk.bands.find((b) => b.band === "2")?.introduced).toBeGreaterThan(0);
  });

  it("gives a recall rate only from five ratings up", async () => {
    const session = await plan();
    await talk(session.id);
    await send("POST", `/sessions/${session.id}/complete`, {});
    const cards = (await listDue(database.db, 50)).cards;
    const ratings = ["good", "again", "easy", "hard"] as const;
    for (const [i, rating] of ratings.entries()) {
      await rateCard(database.db, cards[i]?.id ?? "", { rating, clientEventId: crypto.randomUUID() });
    }
    expect((await summary()).reviews).toEqual({ ratings: 4, recalled: 3, recallRate: null, averageRating: null });

    await rateCard(database.db, cards[4]?.id ?? "", { rating: "good", clientEventId: crypto.randomUUID() });
    const s = await summary();
    expect(s.reviews).toEqual({ ratings: 5, recalled: 4, recallRate: 0.8, averageRating: 2.6 });
    expect(s.hsk.total.bySkill.reading.developing + s.hsk.total.bySkill.listening.developing).toBe(4);
    expect(s.hsk.total.bySkill.reading.practiced + s.hsk.total.bySkill.listening.practiced).toBe(1);
  });

  it("counts only listening answered before the text, and gives accuracy from five checks up", async () => {
    const answerAll = async (reveal: boolean) => {
      const session = await plan({ durationMinutes: 15, freeChat: true });
      const { exercise } = listeningResponseSchema.parse(await (await send("POST", `/sessions/${session.id}/listening`, {})).json());
      if (reveal) await send("POST", `/sessions/${session.id}/listening/events`, { event: "revealed" });
      await send("POST", `/sessions/${session.id}/listening/answers`, { answers: exercise.questions.map(() => 0) });
    };
    await answerAll(true);
    for (let i = 0; i < 4; i += 1) await answerAll(false);
    let s = await summary();
    expect(s.listening).toMatchObject({ checks: 4, questions: 8, assistedChecks: 1, accuracy: null });
    expect(s.listening.lastCheckedAt).not.toBeNull();

    await answerAll(false);
    s = await summary();
    expect(s.listening.checks).toBe(5);
    expect(s.listening.accuracy).toBe(s.listening.correct / s.listening.questions);
  });

  it("sums practice minutes per day of the owner's calendar", async () => {
    const session = await plan();
    await database.db.prepare("UPDATE sessions SET actual_seconds = 750 WHERE id = ?1").bind(session.id).run();
    const s = await summary(7);
    expect(s.practice.days).toHaveLength(7);
    expect(s.practice.days.at(-1)).toEqual({ date: session.localStudyDate, minutes: 12.5 });
    expect(s.practice).toMatchObject({ totalMinutes: 12.5, activeDays: 1 });
  });

  it("refuses other windows", async () => {
    expect((await send("GET", "/progress/summary?days=14")).status).toBe(400);
    expect((await summary(90)).practice.days).toHaveLength(90);
  });
});

describe("windows of calendar days", () => {
  it("ends today in the owner's time zone and has no gaps or repeats", () => {
    const now = new Date("2026-03-10T20:00:00.000Z");
    expect(windowDates(now, 3, "UTC")).toEqual(["2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(windowDates(now, 3, "Asia/Shanghai")).toEqual(["2026-03-09", "2026-03-10", "2026-03-11"]);
    // Across a daylight-saving change in New York (8 March 2026).
    expect(windowDates(new Date("2026-03-09T12:00:00.000Z"), 3, "America/New_York")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("works for the service directly at a fixed time", async () => {
    const s = await getProgressSummary(database.db, 7, new Date("2026-03-10T20:00:00.000Z"));
    expect(s.window).toEqual({ days: 7, from: "2026-03-04", to: "2026-03-10" });
  });
});

describe("learner state on curriculum entries (SPEC §5.4)", () => {
  it("filters by state and reports each skill on the entry", async () => {
    expect((await items("band=2&state=introduced")).total).toBe(0);
    expect((await items("band=2&state=unseen")).total).toBe(200);

    const session = await plan();
    await talk(session.id);
    await send("POST", `/sessions/${session.id}/complete`, {});
    const card = (await listDue(database.db, 50)).cards.find((c) => c.skill === "reading" && c.item.hskBand === "2");
    if (!card) throw new Error("no band 2 card");
    await rateCard(database.db, card.id, { rating: "good", clientEventId: crypto.randomUUID() });

    const developing = await items("band=2&state=developing");
    expect(developing.items.map((i) => i.id)).toEqual([card.item.id]);
    expect(developing.items[0]?.state).toBe("developing");
    const introduced = await items("band=2&state=introduced");
    const band2Targets = session.plan.targets.filter((t) => t.role !== "stretch" && t.hskBand === "2").length;
    expect(introduced.total).toBe(band2Targets - 1);
    expect((await items("band=2&state=unseen")).total).toBe(200 - band2Targets);
    expect((await items("band=2&state=mastered")).total).toBe(0);
    // Each page row carries its state.
    const all = await items("band=2&limit=100");
    expect(all.items.find((i) => i.id === card.item.id)?.state).toBe("developing");

    const detail = curriculumItemDetailResponseSchema.parse(await (await send("GET", `/curriculum/items/${encodeURIComponent(card.item.id)}`)).json());
    expect(detail.item.state).toBe("developing");
    expect(detail.progress.bySkill.map((s) => [s.skill, s.state])).toEqual([
      ["listening", "introduced"],
      ["speaking", "unseen"],
      ["reading", "developing"],
      ["writing", "unseen"],
    ]);
    expect(detail.progress.bySkill.find((s) => s.skill === "reading")).toMatchObject({ successDays: 1, failureCount: 0 });
  });
});
