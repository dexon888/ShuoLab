import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { listDue, rateCard } from "../../src/server/services/review";
import { errorEnvelopeSchema } from "../../src/shared/api";
import { sessionStateResponseSchema } from "../../src/shared/debrief";
import { dueResponseSchema, rateResponseSchema } from "../../src/shared/review";
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

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  return (await database.db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? -1;
}

/** Plans, talks once and finishes a session; returns it. */
async function finishedSession(body: Record<string, unknown> = { durationMinutes: 30, studyBand: "2" }): Promise<SessionDetail> {
  await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE status IN ('planned','active','paused')").run();
  const planned = planResponseSchema.parse(await (await send("POST", "/sessions/plan", body)).json()).session;
  await send("POST", `/sessions/${planned.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript: "你好。", sourceMode: "typed" });
  const done = await send("POST", `/sessions/${planned.id}/complete`, {});
  expect(done.status, await done.clone().text()).toBe(200);
  return sessionStateResponseSchema.parse(await done.json()).session;
}

async function due(limit = 50) {
  const res = await send("GET", `/reviews/due?limit=${limit}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return dueResponseSchema.parse(await res.json());
}

const rate = (id: string, rating: string, clientEventId: string = crypto.randomUUID()) =>
  send("POST", `/reviews/${id}/rate`, { rating, clientEventId });

const mastery = (itemId: string, skill: string) =>
  database.db
    .prepare("SELECT state, success_days, failure_count FROM mastery_states WHERE curriculum_item_id = ?1 AND skill = ?2")
    .bind(itemId, skill)
    .first<{ state: string; success_days: number; failure_count: number }>();

beforeAll(async () => {
  database = await createTestDatabase();
  const vocab = prepare([sourceFile("all.csv", toCsv(makeSyntheticRecords()))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

beforeEach(async () => {
  await database.db.batch([
    database.db.prepare("DELETE FROM review_cards"),
    database.db.prepare("DELETE FROM practice_attempts"),
    database.db.prepare("DELETE FROM mastery_states"),
  ]);
});

describe("review cards come from finished sessions (SPEC §5.5)", () => {
  it("makes a reading and a listening card for each targeted word, except stretch words", async () => {
    const session = await finishedSession();
    const counted = session.plan.targets.filter((t) => t.role !== "stretch");
    const stretch = session.plan.targets.filter((t) => t.role === "stretch");
    expect(stretch.length).toBeGreaterThan(0);

    const list = await due();
    expect(list.totalCards).toBe(counted.length * 2);
    expect(list.dueCount).toBe(counted.length * 2);
    expect(new Set(list.cards.map((c) => c.item.id))).toEqual(new Set(counted.map((t) => t.itemId)));
    expect(new Set(list.cards.map((c) => `${c.template}:${c.skill}`))).toEqual(new Set(["hanzi_to_meaning:reading", "audio_to_meaning:listening"]));
    const card = list.cards[0];
    expect(card).toMatchObject({ state: "new", reps: 0, mastery: "introduced" });
    expect(card?.item.synthetic).toBe(true);

    // Finishing does not count as knowing: every targeted word is only introduced.
    for (const t of counted) expect((await mastery(t.itemId, "reading"))?.state).toBe("introduced");
    for (const t of stretch) expect(await mastery(t.itemId, "reading")).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM practice_attempts")).toBe(0);
  });

  it("makes no second set of cards when the same word comes up again", async () => {
    await finishedSession();
    const first = (await due()).totalCards;
    // Finishing again, and a later session with overlapping words, add no duplicates.
    const again = await finishedSession();
    await send("POST", `/sessions/${again.id}/complete`, {});
    expect(await count("SELECT COUNT(*) AS n FROM (SELECT curriculum_item_id, template FROM review_cards GROUP BY 1, 2 HAVING COUNT(*) > 1)")).toBe(0);
    expect((await due()).totalCards).toBeGreaterThanOrEqual(first);
  });

  it("makes no cards for an open conversation", async () => {
    await finishedSession({ durationMinutes: 15, freeChat: true });
    expect((await due()).totalCards).toBe(0);
  });
});

describe("rating a card (SPEC §5.5, FR-014)", () => {
  it("schedules the card, keeps the history and records a recall attempt", async () => {
    await finishedSession();
    const card = (await due()).cards[0];
    if (!card) throw new Error("no card");
    const res = await rate(card.id, "good");
    expect(res.status).toBe(201);
    const result = rateResponseSchema.parse(await res.json());
    expect(result).toMatchObject({ cardId: card.id, rating: "good", state: "learning", mastery: "developing", replayed: false });
    // The preview was worked out when the card was fetched, a moment earlier.
    expect(Math.abs(Date.parse(result.nextDueAt) - Date.parse(card.preview.good))).toBeLessThan(1000);

    expect(await count("SELECT COUNT(*) AS n FROM review_events WHERE review_card_id = ?1", card.id)).toBe(1);
    const attempt = await database.db
      .prepare("SELECT skill, assessment_type, prompt_id, score_source, is_qualifying_recall, success, session_id FROM practice_attempts")
      .first();
    expect(attempt).toEqual({
      skill: card.skill,
      assessment_type: "review_self_rating",
      prompt_id: card.template,
      score_source: "self",
      is_qualifying_recall: 1,
      success: 1,
      session_id: null,
    });
    // The rated card is no longer due.
    expect((await due()).cards.map((c) => c.id)).not.toContain(card.id);
  });

  it("records a resent rating once", async () => {
    await finishedSession();
    const card = (await due()).cards[0];
    if (!card) throw new Error("no card");
    const id = crypto.randomUUID();
    const first = rateResponseSchema.parse(await (await rate(card.id, "good", id)).json());
    const res = await rate(card.id, "good", id);
    expect(res.status).toBe(200);
    expect(rateResponseSchema.parse(await res.json())).toEqual({ ...first, replayed: true });
    expect(await count("SELECT COUNT(*) AS n FROM review_events")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM practice_attempts")).toBe(1);
  });

  it("records two copies of a rating sent at the same moment once", async () => {
    await finishedSession();
    const card = (await due()).cards[0];
    if (!card) throw new Error("no card");
    const id = crypto.randomUUID();
    const responses = await Promise.all([rate(card.id, "hard", id), rate(card.id, "hard", id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count("SELECT COUNT(*) AS n FROM review_events")).toBe(1);
  });

  it("refuses a different rating of a card that changed since it was read", async () => {
    await finishedSession();
    const card = (await due()).cards[0];
    if (!card) throw new Error("no card");
    const responses = await Promise.all([rate(card.id, "good"), rate(card.id, "again")]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    // The second either went first-come after the first (201) or found the card changed (409).
    expect([201, 409]).toContain(statuses[1]);
    expect(await count("SELECT COUNT(*) AS n FROM review_events")).toBe(await count("SELECT COUNT(*) AS n FROM practice_attempts"));
  });

  it("refuses a clientEventId reused for another card, and malformed requests", async () => {
    await finishedSession();
    const [a, b] = (await due()).cards;
    if (!a || !b) throw new Error("no cards");
    const id = crypto.randomUUID();
    await rate(a.id, "good", id);
    expect((await rate(b.id, "good", id)).status).toBe(409);
    expect((await rate(a.id, "perfect")).status).toBe(400);
    expect((await send("POST", `/reviews/${a.id}/rate`, { rating: "good" })).status).toBe(400);
    const missing = await rate(crypto.randomUUID(), "good");
    expect(missing.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await missing.json()).error.code).toBe("NOT_FOUND");
    expect((await rate("not-an-id", "good")).status).toBe(400);
    expect((await send("GET", "/reviews/due?limit=500")).status).toBe(400);
  });
});

describe("mastery comes only from spaced recall (SPEC §6.1, FR-015)", () => {
  it("reaches mastered after good recalls on three days, one a day or more later, and drops on a miss", async () => {
    const session = await finishedSession();
    const list = await listDue(database.db, 50, new Date());
    const card = list.cards.find((c) => c.skill === "reading");
    if (!card) throw new Error("no card");
    const at = (days: number) => new Date(Date.now() + days * 86_400_000);
    const go = (rating: "good" | "again", days: number) => rateCard(database.db, card.id, { rating, clientEventId: crypto.randomUUID() }, at(days));

    expect((await go("good", 0)).mastery).toBe("developing");
    expect((await go("good", 1)).mastery).toBe("developing");
    expect((await go("good", 3)).mastery).toBe("mastered");
    // The listening skill for the same word is untouched.
    expect((await mastery(card.item.id, "listening"))?.state).toBe("introduced");

    expect((await go("again", 10)).mastery).toBe("developing");
    expect(await mastery(card.item.id, "reading")).toEqual({ state: "developing", success_days: 3, failure_count: 1 });
    // History is never rewritten.
    expect(await count("SELECT COUNT(*) AS n FROM review_events WHERE review_card_id = ?1", card.id)).toBe(4);
    expect(session.plan.targets.some((t) => t.itemId === card.item.id)).toBe(true);
  });

  it("is practiced after a miss with no recall yet", async () => {
    await finishedSession();
    const card = (await due()).cards[0];
    if (!card) throw new Error("no card");
    const result = rateResponseSchema.parse(await (await rate(card.id, "again")).json());
    expect(result).toMatchObject({ mastery: "practiced", state: "learning" });
  });

  it("keeps cards and evidence when a session is deleted", async () => {
    const session = await finishedSession();
    const card = (await due()).cards[0];
    if (!card) throw new Error("no card");
    await rate(card.id, "good");
    await database.db.prepare("DELETE FROM sessions WHERE id = ?1").bind(session.id).run();
    expect(await count("SELECT COUNT(*) AS n FROM practice_attempts")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM review_cards WHERE id = ?1", card.id)).toBe(1);
  });
});
