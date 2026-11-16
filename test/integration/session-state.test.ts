import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider, fakeTutorOutput, type FakeTutorOptions } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { applySessionAction, completeSession, getSessionState } from "../../src/server/services/session-state";
import { takeTurn } from "../../src/server/services/turns";
import { errorEnvelopeSchema } from "../../src/shared/api";
import { sessionStateResponseSchema } from "../../src/shared/debrief";
import { planResponseSchema, type SessionDetail } from "../../src/shared/session";
import type { TurnRequest } from "../../src/shared/tutor";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

let database: TestDatabase;
let tutor: FakeTutorProvider;
const app = createApp({ tutor: () => tutor });

function api(path: string, init: RequestInit = {}) {
  return app.request(`http://localhost/api/v1${path}`, init, { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });
}

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function useTutor(options: FakeTutorOptions = {}) {
  tutor = new FakeTutorProvider(options);
}

async function newSession(body: Record<string, unknown> = { durationMinutes: 30, studyBand: "2" }): Promise<SessionDetail> {
  await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE status IN ('planned','active','paused')").run();
  const res = await send("POST", "/sessions/plan", body);
  expect(res.status, await res.clone().text()).toBe(201);
  return planResponseSchema.parse(await res.json()).session;
}

function message(transcript = "你好！", over: Partial<TurnRequest> = {}): TurnRequest {
  return { clientTurnId: crypto.randomUUID(), transcript, sourceMode: "typed", asrUncertain: false, ...over };
}

const T0 = Date.parse("2026-03-04T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

async function state(res: Response, status = 200) {
  expect(res.status, await res.clone().text()).toBe(status);
  return sessionStateResponseSchema.parse(await res.json());
}

async function refused(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  return errorEnvelopeSchema.parse(await res.json()).error;
}

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
  useTutor();
  await database.db.prepare("DELETE FROM usage_events").run();
});

describe("practice time (SPEC §8.3)", () => {
  it("counts the time between actions, caps long gaps, and leaves out paused time", async () => {
    const { id } = await newSession();
    const seconds = async () => (await getSessionState(database.db, id)).session.actualSeconds;

    await takeTurn(database.db, tutor, id, message(), at(0));
    expect(await seconds()).toBe(0);

    await takeTurn(database.db, tutor, id, message(), at(40));
    expect(await seconds()).toBe(40);

    // Ten minutes away from the screen counts as three.
    await takeTurn(database.db, tutor, id, message(), at(640));
    expect(await seconds()).toBe(220);

    await applySessionAction(database.db, id, "pause", at(650));
    expect(await seconds()).toBe(230);

    // An hour paused adds nothing, and the clock restarts on resume.
    await applySessionAction(database.db, id, "resume", at(4250));
    expect(await seconds()).toBe(230);
    await takeTurn(database.db, tutor, id, message(), at(4270));
    expect(await seconds()).toBe(250);

    const done = await completeSession(database.db, id, at(4300));
    expect(done.session).toMatchObject({ status: "complete", actualSeconds: 280, endedAt: at(4300).toISOString() });
    expect(done.debrief?.practiceSeconds).toBe(280);
  });

  it("does not count time twice when a turn is replayed or a request is repeated", async () => {
    const { id } = await newSession();
    const first = message();
    await takeTurn(database.db, tutor, id, first, at(0));
    await takeTurn(database.db, tutor, id, message(), at(30));
    await takeTurn(database.db, tutor, id, first, at(90));
    expect((await getSessionState(database.db, id)).session.actualSeconds).toBe(30);

    await applySessionAction(database.db, id, "pause", at(50));
    await applySessionAction(database.db, id, "pause", at(170));
    expect((await getSessionState(database.db, id)).session.actualSeconds).toBe(50);

    const done = await completeSession(database.db, id, at(5000));
    const again = await completeSession(database.db, id, at(9000));
    expect(done.session.actualSeconds).toBe(50);
    expect(again).toEqual(done);
  });
});

describe("pause, resume and abandon (SPEC §9)", () => {
  it("pauses and resumes through the API, refusing turns while paused", async () => {
    const { id } = await newSession();
    const first = message();
    expect((await send("POST", `/sessions/${id}/turn`, first)).status).toBe(201);

    const paused = await state(await send("PATCH", `/sessions/${id}`, { action: "pause" }));
    expect(paused.session.status).toBe("paused");
    expect(paused.turns).toHaveLength(1);
    expect(paused.debrief).toBeNull();

    const error = await refused(await send("POST", `/sessions/${id}/turn`, message()), 409);
    expect(error.message).toMatch(/paused\. Resume it/);
    expect(tutor.requests).toHaveLength(1);
    // A message that was already answered can still be read back.
    expect((await send("POST", `/sessions/${id}/turn`, first)).status).toBe(200);

    const resumed = await state(await send("PATCH", `/sessions/${id}`, { action: "resume" }));
    expect(resumed.session.status).toBe("active");
    expect((await send("POST", `/sessions/${id}/turn`, message())).status).toBe(201);
  });

  it("treats a repeated pause or resume as already done", async () => {
    const { id } = await newSession();
    await send("POST", `/sessions/${id}/turn`, message());
    expect((await state(await send("PATCH", `/sessions/${id}`, { action: "resume" }))).session.status).toBe("active");
    await send("PATCH", `/sessions/${id}`, { action: "pause" });
    expect((await state(await send("PATCH", `/sessions/${id}`, { action: "pause" }))).session.status).toBe("paused");
  });

  it("refuses to pause or resume a session that has not started", async () => {
    const { id } = await newSession();
    for (const action of ["pause", "resume"]) {
      const error = await refused(await send("PATCH", `/sessions/${id}`, { action }), 409);
      expect(error.message).toMatch(/has not started/);
    }
  });

  it("abandons a session, after which nothing more can be added", async () => {
    const { id } = await newSession();
    await send("POST", `/sessions/${id}/turn`, message());
    const abandoned = await state(await send("PATCH", `/sessions/${id}`, { action: "abandon" }));
    expect(abandoned.session.status).toBe("abandoned");
    expect(abandoned.session.endedAt).not.toBeNull();
    expect(abandoned.debrief).toBeNull();

    expect((await state(await send("PATCH", `/sessions/${id}`, { action: "abandon" }))).session.status).toBe("abandoned");
    expect((await send("POST", `/sessions/${id}/turn`, message())).status).toBe(409);
    expect((await send("POST", `/sessions/${id}/complete`)).status).toBe(409);
    expect((await send("PATCH", `/sessions/${id}`, { action: "resume" })).status).toBe(409);
  });

  it("abandons a plan that was never started, and frees the day for a new plan", async () => {
    const { id } = await newSession();
    await state(await send("PATCH", `/sessions/${id}`, { action: "abandon" }));
    const res = await send("POST", "/sessions/plan", { durationMinutes: 30, studyBand: "2" });
    expect(res.status).toBe(201);
    expect(planResponseSchema.parse(await res.json()).session.id).not.toBe(id);
  });

  it("rejects unknown actions, extra fields, bad ids and other sites", async () => {
    const { id } = await newSession();
    for (const body of [{}, { action: "delete" }, { action: "pause", status: "complete" }, { status: "complete" }]) {
      expect((await send("PATCH", `/sessions/${id}`, body)).status).toBe(400);
    }
    expect((await send("PATCH", "/sessions/11111111-2222-4333-8444-555555555555", { action: "pause" })).status).toBe(404);
    expect((await send("PATCH", "/sessions/nope", { action: "pause" })).status).toBe(400);
    expect((await send("POST", "/sessions/11111111-2222-4333-8444-555555555555/complete")).status).toBe(404);
    expect((await send("PATCH", `/sessions/${id}`, { action: "abandon" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await send("POST", `/sessions/${id}/complete`, undefined, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await getSessionState(database.db, id)).session.status).toBe("planned");
  });
});

describe("finishing a session (SPEC §5.3 step 6, §9)", () => {
  it("refuses to finish a session with no turns", async () => {
    const { id } = await newSession();
    const error = await refused(await send("POST", `/sessions/${id}/complete`), 409);
    expect(error.message).toMatch(/no turns yet/);
  });

  it("completes once and returns the same summary every time after", async () => {
    const { id } = await newSession();
    await send("POST", `/sessions/${id}/turn`, message());
    const first = await state(await send("POST", `/sessions/${id}/complete`));
    expect(first.session.status).toBe("complete");
    expect(first.debrief).not.toBeNull();

    const second = await state(await send("POST", `/sessions/${id}/complete`));
    expect(second).toEqual(first);
    expect(await state(await api(`/sessions/${id}`))).toEqual(first);

    expect((await send("POST", `/sessions/${id}/turn`, message())).status).toBe(409);
    expect((await send("PATCH", `/sessions/${id}`, { action: "abandon" })).status).toBe(409);
    expect((await send("PATCH", `/sessions/${id}`, { action: "pause" })).status).toBe(409);
  });

  it("completes a paused session without adding the paused time", async () => {
    const { id } = await newSession();
    await takeTurn(database.db, tutor, id, message(), at(0));
    await applySessionAction(database.db, id, "pause", at(20));
    const done = await completeSession(database.db, id, at(900));
    expect(done.session).toMatchObject({ status: "complete", actualSeconds: 20 });
  });

  it("lets Today plan a new session after one is complete", async () => {
    const { id } = await newSession();
    await send("POST", `/sessions/${id}/turn`, message());
    await send("POST", `/sessions/${id}/complete`);
    const res = await send("POST", "/sessions/plan", {});
    expect(res.status).toBe(201);
  });
});

describe("the summary reports what happened, not what was learned", () => {
  it("says which planned words the learner used, which only the tutor used, and which to meet again", async () => {
    const session = await newSession();
    const [first, second, third] = session.plan.targets;
    if (!first || !second || !third) throw new Error("fixture: need three targets");

    // The stand-in tutor uses the first target on turn one and the second on turn two.
    await send("POST", `/sessions/${session.id}/turn`, message(`我喜欢${second.hanzi}。`));
    await send("POST", `/sessions/${session.id}/turn`, message("好的。", { sourceMode: "speech" }));
    const { debrief } = await state(await send("POST", `/sessions/${session.id}/complete`));
    if (!debrief) throw new Error("no debrief");

    expect(debrief.turns).toEqual({ total: 2, typed: 1, spoken: 1, fallback: 0 });
    expect(debrief.plannedMinutes).toBe(30);
    expect(debrief.words.map((w) => w.itemId)).toEqual(session.plan.targets.map((t) => t.itemId));
    const word = (id: string) => debrief.words.find((w) => w.itemId === id);
    expect(word(first.itemId)).toMatchObject({ usedByLearner: false, usedByTutor: true });
    expect(word(second.itemId)).toMatchObject({ usedByLearner: true, usedByTutor: true });
    expect(word(third.itemId)).toMatchObject({ usedByLearner: false, usedByTutor: false });

    expect(debrief.recommendedReviewItemIds).not.toContain(second.itemId);
    expect(debrief.recommendedReviewItemIds).toContain(first.itemId);
    const stretch = session.plan.targets.filter((t) => t.role === "stretch").map((t) => t.itemId);
    expect(stretch.length).toBeGreaterThan(0);
    for (const id of stretch) expect(debrief.recommendedReviewItemIds).not.toContain(id);
    // Nothing in the summary is a score or a level.
    expect(JSON.stringify(debrief)).not.toMatch(/master|score|fluen|level/i);
  });

  it("keeps at most three corrections, newest first, without repeats", async () => {
    const { id } = await newSession();
    const fix = (n: number) => ({ original: `错${n}`, corrected: `对${n}`, note_en: `note ${n}` });
    const perTurn = [[fix(1), fix(2)], [fix(2)], [fix(3), fix(4)]];
    useTutor({
      respond: (request) =>
        JSON.stringify({
          ...fakeTutorOutput(request),
          semantic_feedback: { understood_intent: true, corrections: perTurn[request.context.turnIndex] ?? [], encouragement_zh: null },
        }),
    });
    for (let i = 0; i < 3; i += 1) await send("POST", `/sessions/${id}/turn`, message());
    const { debrief } = await state(await send("POST", `/sessions/${id}/complete`));
    expect(debrief?.corrections.map((c) => c.original)).toEqual(["错3", "错4", "错2"]);
    expect(debrief?.corrections[0]).toEqual({ original: "错3", corrected: "对3", noteEn: "note 3" });
  });

  it("does not credit the tutor with words from a prepared fallback reply", async () => {
    const session = await newSession();
    useTutor({ respond: () => "not json" });
    await send("POST", `/sessions/${session.id}/turn`, message());
    const { debrief } = await state(await send("POST", `/sessions/${session.id}/complete`));
    expect(debrief?.turns.fallback).toBe(1);
    expect(debrief?.words.every((w) => !w.usedByTutor)).toBe(true);
    expect(debrief?.corrections).toEqual([]);
  });

  it("has no words for an open conversation", async () => {
    const session = await newSession({ freeChat: true, durationMinutes: 15 });
    await send("POST", `/sessions/${session.id}/turn`, message());
    const { debrief } = await state(await send("POST", `/sessions/${session.id}/complete`));
    expect(debrief).toMatchObject({ words: [], recommendedReviewItemIds: [], plannedMinutes: 15 });
  });
});

describe("listening record (SPEC §10)", () => {
  it("keeps the first time a reply was heard and the first time its text was shown", async () => {
    const { id } = await newSession();
    const res = await send("POST", `/sessions/${id}/turn`, message());
    const { turn } = (await res.json()) as { turn: { turnId: string; listening: unknown } };
    expect(turn.listening).toEqual({ playedAt: null, revealedAt: null });

    const event = (body: unknown, turnId = turn.turnId, sessionId = id) => send("POST", `/sessions/${sessionId}/turns/${turnId}/events`, body);
    const played = (await (await event({ event: "played" })).json()) as { listening: { playedAt: string | null; revealedAt: string | null } };
    expect(played.listening.playedAt).not.toBeNull();
    expect(played.listening.revealedAt).toBeNull();

    // Repeating changes nothing: the first time is what matters.
    const again = (await (await event({ event: "played" })).json()) as { listening: { playedAt: string | null } };
    expect(again.listening.playedAt).toBe(played.listening.playedAt);

    await event({ event: "revealed" });
    const saved = sessionStateResponseSchema.parse(await (await api(`/sessions/${id}`)).json());
    expect(saved.turns[0]?.listening.playedAt).toBe(played.listening.playedAt);
    expect(saved.turns[0]?.listening.revealedAt).not.toBeNull();
  });

  it("can be recorded after the session ends, since replies can be replayed from the summary", async () => {
    const { id } = await newSession();
    const { turn } = (await (await send("POST", `/sessions/${id}/turn`, message())).json()) as { turn: { turnId: string } };
    await send("POST", `/sessions/${id}/complete`);
    expect((await send("POST", `/sessions/${id}/turns/${turn.turnId}/events`, { event: "played" })).status).toBe(200);
  });

  it("refuses unknown events, turns from other sessions, and other sites", async () => {
    const first = await newSession();
    const { turn } = (await (await send("POST", `/sessions/${first.id}/turn`, message())).json()) as { turn: { turnId: string } };
    const other = await newSession();

    const url = `/sessions/${first.id}/turns/${turn.turnId}/events`;
    expect((await send("POST", url, { event: "understood" })).status).toBe(400);
    expect((await send("POST", url, { event: "played", at: "2020-01-01" })).status).toBe(400);
    expect((await send("POST", `/sessions/${other.id}/turns/${turn.turnId}/events`, { event: "played" })).status).toBe(404);
    expect((await send("POST", `/sessions/${first.id}/turns/not-a-turn/events`, { event: "played" })).status).toBe(400);
    expect((await send("POST", url, { event: "played" }, { Origin: "https://evil.example" })).status).toBe(403);
    const row = await database.db.prepare("SELECT reply_played_at FROM conversation_turns WHERE id = ?1").bind(turn.turnId).first<{ reply_played_at: string | null }>();
    expect(row?.reply_played_at).toBeNull();
  });
});
