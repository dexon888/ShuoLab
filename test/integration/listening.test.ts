import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider, fakeListeningOutput, type FakeTutorOptions } from "../../src/server/providers/fake";
import { ProviderError, type TutorRequest } from "../../src/server/providers/types";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { MAX_TUTOR_CALLS_PER_MINUTE } from "../../src/server/services/usage";
import { errorEnvelopeSchema } from "../../src/shared/api";
import { sessionStateResponseSchema } from "../../src/shared/debrief";
import { LISTENING_FORMAT_NAME, listeningResponseSchema, type ListeningOutput } from "../../src/shared/listening";
import { planResponseSchema, type SessionDetail } from "../../src/shared/session";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and the local stand-in tutor: no model is called.
let database: TestDatabase;
let tutor: FakeTutorProvider;
const app = createApp({ tutor: () => tutor });
const ENV = () => ({ DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });

function send(method: string, path: string, body?: unknown) {
  return app.request(
    `http://localhost/api/v1${path}`,
    { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    ENV(),
  );
}

function useTutor(options: FakeTutorOptions = {}) {
  tutor = new FakeTutorProvider(options);
  return tutor;
}

async function newSession(body: Record<string, unknown> = { durationMinutes: 15, studyBand: "2" }): Promise<SessionDetail> {
  await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE status IN ('planned','active','paused')").run();
  const res = await send("POST", "/sessions/plan", body);
  expect(res.status, await res.clone().text()).toBe(201);
  return planResponseSchema.parse(await res.json()).session;
}

const start = (id: string) => send("POST", `/sessions/${id}/listening`, {});
const answer = (id: string, answers: number[]) => send("POST", `/sessions/${id}/listening/answers`, { answers });
const event = (id: string, name: string) => send("POST", `/sessions/${id}/listening/events`, { event: name });

async function ok(res: Response) {
  expect([200, 201], await res.clone().text()).toContain(res.status);
  return listeningResponseSchema.parse(await res.json());
}

async function failed(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  return errorEnvelopeSchema.parse(await res.json()).error;
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  return (await database.db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? -1;
}

async function state(id: string) {
  return sessionStateResponseSchema.parse(await (await send("GET", `/sessions/${id}`)).json());
}

function modelAnswer(request: TutorRequest, over: Partial<ListeningOutput> = {}): string {
  return JSON.stringify({ ...fakeListeningOutput(request), ...over });
}

/** The right option for each question, found by its text, since options are shuffled. */
const RIGHT = ["Saturday afternoon", "Doing something together"];
function rightAnswers(exercise: { questions: { optionsEn: string[] }[] }): number[] {
  return exercise.questions.map((q, i) => q.optionsEn.indexOf(RIGHT[i] as string));
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

describe("writing the listen-first exercise (SPEC §5.3 step 2)", () => {
  it("writes an exchange and questions, withholds the answers and starts the session", async () => {
    const session = await newSession();
    const res = await start(session.id);
    expect(res.status).toBe(201);
    const { exercise, existing } = await ok(res);

    expect(existing).toBe(false);
    expect(exercise).toMatchObject({ sessionId: session.id, source: "generated", model: "fake-tutor-1", standIn: true, answers: null, result: null });
    expect(exercise.lines.length).toBeGreaterThanOrEqual(2);
    expect(exercise.questions).toHaveLength(2);
    expect(exercise.questions.every((q) => q.answerIndex === null && q.optionsEn.length === 3)).toBe(true);

    const request = tutor.requests[0];
    expect(request?.format?.name).toBe(LISTENING_FORMAT_NAME);
    expect(request?.instructions).toContain(session.plan.targets[0]?.hanzi);
    expect(request?.instructions).toContain(session.plan.situation.titleZh);
    expect((await state(session.id)).session.status).toBe("active");
    expect(await count("SELECT COUNT(*) AS n FROM usage_events WHERE operation = 'listening_exercise' AND status = 'ok'")).toBe(1);
  });

  it("returns the same exercise when asked again, without calling the tutor", async () => {
    const session = await newSession();
    const first = await ok(await start(session.id));
    const again = await start(session.id);
    expect(again.status).toBe(200);
    const second = await ok(again);
    expect(second.existing).toBe(true);
    expect(second.exercise.id).toBe(first.exercise.id);
    expect(tutor.requests).toHaveLength(1);
    expect((await state(session.id)).listening?.id).toBe(first.exercise.id);
  });

  it("calls the tutor once when asked twice at the same moment", async () => {
    const session = await newSession();
    const responses = await Promise.all([start(session.id), start(session.id)]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([200, 409]).toContain(statuses[1]);
    expect(tutor.requests).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM listening_exercises WHERE session_id = ?1", session.id)).toBe(1);
  });

  it("works in an open conversation, with no syllabus words", async () => {
    const session = await newSession({ durationMinutes: 15, freeChat: true });
    await ok(await start(session.id));
    expect(tutor.requests[0]?.instructions).not.toMatch(/HSK \d/);
    expect(tutor.requests[0]?.context.targets).toEqual([]);
  });

  it("refuses while paused and after the session ended without one", async () => {
    const session = await newSession();
    await database.db.prepare("UPDATE sessions SET status = 'paused' WHERE id = ?1").bind(session.id).run();
    expect((await failed(await start(session.id), 409)).message).toMatch(/paused/);
    await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE id = ?1").bind(session.id).run();
    expect((await failed(await start(session.id), 409)).message).toMatch(/ended/);
    expect(tutor.requests).toHaveLength(0);
  });
});

describe("the model's exercise is checked before it is saved (SPEC §6.4)", () => {
  it("retries once after an unusable answer, saying what was wrong", async () => {
    let calls = 0;
    useTutor({
      respond: (request) => {
        calls += 1;
        return calls === 1 ? modelAnswer(request, { questions: [] }) : modelAnswer(request);
      },
    });
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    expect(exercise.source).toBe("generated");
    expect(tutor.requests).toHaveLength(2);
    expect(tutor.requests[1]?.instructions).toMatch(/previous answer did not match/);
    expect(await count("SELECT COUNT(*) AS n FROM usage_events WHERE status = 'invalid'")).toBe(1);
  });

  it("rejects English lines and duplicate options", async () => {
    const replies = [
      (r: TutorRequest) => modelAnswer(r, { lines: fakeListeningOutput(r).lines.map((l) => ({ ...l, zh: "Hello there, how are you?" })) }),
      (r: TutorRequest) =>
        modelAnswer(r, { questions: fakeListeningOutput(r).questions.map((q) => ({ ...q, options_en: ["Same", "same", "Other"] })) }),
    ];
    let calls = 0;
    useTutor({ respond: (r) => (replies[calls++] as (r: TutorRequest) => string)(r) });
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    expect(exercise.source).toBe("prepared");
  });

  it("uses a prepared exchange, labelled as such, after two unusable answers", async () => {
    useTutor({ respond: () => "not json" });
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    expect(exercise).toMatchObject({ source: "prepared", model: null, standIn: false });
    expect(exercise.questions).toHaveLength(3);
    expect(await count("SELECT COUNT(*) AS n FROM usage_events WHERE status = 'invalid'")).toBe(2);
  });

  it("reports an unreachable tutor, saves nothing, and works when tried again", async () => {
    useTutor({
      respond: () => {
        throw new ProviderError("timeout");
      },
    });
    const session = await newSession();
    const error = await failed(await start(session.id), 503);
    expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect((await state(session.id)).listening).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM usage_events WHERE status = 'error'")).toBe(1);

    useTutor();
    const res = await start(session.id);
    expect(res.status).toBe(201);
    expect(await count("SELECT COUNT(*) AS n FROM listening_exercises WHERE session_id = ?1", session.id)).toBe(1);
  });

  it("counts toward the tutor's request limit", async () => {
    const session = await newSession();
    const now = new Date().toISOString();
    await database.db.batch(
      Array.from({ length: MAX_TUTOR_CALLS_PER_MINUTE }, () =>
        database.db
          .prepare("INSERT INTO usage_events (id, provider, operation, status, recorded_at) VALUES (?1, 'x', 'listening_exercise', 'ok', ?2)")
          .bind(crypto.randomUUID(), now),
      ),
    );
    expect((await failed(await start(session.id), 429)).code).toBe("RATE_LIMITED");
    const turn = await send("POST", `/sessions/${session.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript: "你好。", sourceMode: "typed" });
    expect(turn.status).toBe(429);
    expect(tutor.requests).toHaveLength(0);
  });
});

describe("answering before the text is shown (SPEC §6.5, §10)", () => {
  it("scores answers given before any reveal as unassisted, and then shows the right answers", async () => {
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    const right = rightAnswers(exercise);
    expect(right.every((i) => i >= 0)).toBe(true);

    const wrong = right.map((r, i) => (i === 0 ? (r + 1) % 3 : r));
    const scored = await ok(await answer(session.id, wrong));
    expect(scored.exercise.result).toEqual({ correct: 1, total: 2, unassisted: true });
    expect(scored.exercise.answers).toEqual(wrong);
    expect(scored.exercise.questions.map((q) => q.answerIndex)).toEqual(right);
  });

  it("keeps the first answers: the same again is accepted, different ones are refused", async () => {
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    const right = rightAnswers(exercise);
    await ok(await answer(session.id, right));
    expect((await ok(await answer(session.id, right))).exercise.result?.correct).toBe(2);
    await failed(await answer(session.id, right.map((r) => (r + 1) % 3)), 409);
  });

  it("does not count answers given after the text was shown", async () => {
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    const revealed = await ok(await event(session.id, "revealed"));
    // Once the text is shown the answers are no secret.
    expect(revealed.exercise.questions.every((q) => q.answerIndex !== null)).toBe(true);
    const scored = await ok(await answer(session.id, rightAnswers(exercise)));
    expect(scored.exercise.result).toEqual({ correct: 2, total: 2, unassisted: false });
  });

  it("keeps the first play and reveal times", async () => {
    const session = await newSession();
    await ok(await start(session.id));
    const first = await ok(await event(session.id, "played"));
    expect(first.exercise.playedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    const again = await ok(await event(session.id, "played"));
    expect(again.exercise.playedAt).toBe(first.exercise.playedAt);
    expect(again.exercise.revealedAt).toBeNull();
  });

  it("rejects malformed answers and events", async () => {
    const session = await newSession();
    expect((await failed(await answer(session.id, [0, 0]), 404)).code).toBe("NOT_FOUND");
    await ok(await start(session.id));
    await failed(await answer(session.id, [0]), 400);
    await failed(await answer(session.id, [0, 3]), 400);
    await failed(await send("POST", `/sessions/${session.id}/listening/answers`, { answers: [0, 0], extra: 1 }), 400);
    await failed(await event(session.id, "heard"), 400);
  });

  it("puts the result in the summary once the session is finished", async () => {
    const session = await newSession();
    const { exercise } = await ok(await start(session.id));
    await ok(await answer(session.id, rightAnswers(exercise)));
    const done = sessionStateResponseSchema.parse(await (await send("POST", `/sessions/${session.id}/complete`, {})).json());
    expect(done.debrief?.listening).toEqual({ correct: 2, total: 2, unassisted: true });
    // The finished session still returns its exercise instead of writing a new one.
    expect((await start(session.id)).status).toBe(200);
  });

  it("is removed with its session", async () => {
    const session = await newSession();
    await ok(await start(session.id));
    await database.db.prepare("DELETE FROM sessions WHERE id = ?1").bind(session.id).run();
    expect(await count("SELECT COUNT(*) AS n FROM listening_exercises WHERE session_id = ?1", session.id)).toBe(0);
  });
});
