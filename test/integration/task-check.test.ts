import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { verifyCriteria } from "../../src/server/services/task-check";
import { curriculumItemDetailResponseSchema } from "../../src/shared/api";
import { progressSummarySchema } from "../../src/shared/progress";
import { dueResponseSchema } from "../../src/shared/review";
import { planResponseSchema, type SessionDetail } from "../../src/shared/session";
import { flagListResponseSchema, taskCheckResponseSchema } from "../../src/shared/task-check";
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

async function plan(): Promise<SessionDetail> {
  const res = await send("POST", "/sessions/plan", { durationMinutes: 20, studyBand: "1" });
  expect([200, 201], await res.clone().text()).toContain(res.status);
  return planResponseSchema.parse(await res.json()).session;
}

async function finish(session: SessionDetail, said: string[]) {
  for (const transcript of said) {
    await send("POST", `/sessions/${session.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript, sourceMode: "typed", asrUncertain: false });
  }
  await send("POST", `/sessions/${session.id}/complete`, {});
}

const check = async (id: string) => {
  const res = await send("POST", `/sessions/${id}/task-check`, {});
  expect(res.status, await res.clone().text()).toBe(200);
  return taskCheckResponseSchema.parse(await res.json()).check;
};

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
  for (const table of ["usage_events", "task_checks", "item_flags", "review_events", "practice_attempts", "mastery_states", "review_cards", "sessions"]) {
    await database.db.prepare(`DELETE FROM ${table}`).run();
  }
});

describe("the task check (SPEC §6.1, FR-030)", () => {
  it("credits a criterion only when the quoted evidence is in what the learner said", () => {
    const criteria = verifyCriteria(
      {
        criteria: [
          { label_en: "Stated a time", met: true, evidence_quote: "三点见" },
          { label_en: "Proposed a place", met: true, evidence_quote: "在公园门口" },
          { label_en: "Asked a question", met: false, evidence_quote: "" },
        ],
      },
      "我们三点见吧。",
    );
    expect(criteria).toEqual([
      { label: "Stated a time", met: true, evidence: "三点见" },
      { label: "Proposed a place", met: false, evidence: null },
      { label: "Asked a question", met: false, evidence: null },
    ]);
  });

  it("is refused before the session is finished, then judged once and kept", async () => {
    const session = await plan();
    expect((await send("POST", `/sessions/${session.id}/task-check`, {})).status).toBe(409);
    await finish(session, ["我是坐车来的。", "我们三点见吧。"]);
    const first = await check(session.id);
    expect(first).toMatchObject({ passed: true, scorerVersion: "task-check-v1", standIn: true, canDo: session.plan.task?.canDo });
    expect(first?.criteria.every((c) => c.met && c.evidence)).toBe(true);
    expect(first?.task).toEqual({ passes: 1, topics: 1, achieved: false });
    await check(session.id);
    expect(tutor.requests.filter((r) => r.format?.name === "task_check")).toHaveLength(1);
    const read = taskCheckResponseSchema.parse(await (await send("GET", `/sessions/${session.id}/task-check`)).json());
    expect(read.check?.checkedAt).toBe(first?.checkedAt);
  });

  it("does not pass with too little said", async () => {
    const session = await plan();
    await finish(session, ["你好。"]);
    expect((await check(session.id))?.passed).toBe(false);
  });

  it("counts a task achieved after passes on two days in two topics, and then plans other tasks first", async () => {
    const first = await plan();
    await finish(first, ["我是坐车来的。", "我们三点见吧。"]);
    await check(first.id);
    // A second pass on another day, in another topic.
    await database.db.prepare("UPDATE sessions SET local_study_date = date(local_study_date, '-2 day')").run();
    await database.db.prepare("UPDATE task_checks SET local_study_date = date(local_study_date, '-2 day')").run();
    const second = await plan();
    expect(second.plan.task?.itemId).not.toBe(first.plan.task?.itemId);
    await database.db.prepare("UPDATE sessions SET plan_json = json_set(plan_json, '$.task', json(?2)) WHERE id = ?1").bind(second.id, JSON.stringify(first.plan.task)).run();
    await database.db.prepare("UPDATE session_items SET curriculum_item_id = ?2 WHERE session_id = ?1 AND item_type = 'task'").bind(second.id, first.plan.task?.itemId).run();
    await finish(second, ["我想去公园。", "我们明天见吧。"]);
    const result = await check(second.id);
    expect(result?.task).toEqual({ passes: 2, topics: 2, achieved: true });
    const p = progressSummarySchema.parse(await (await send("GET", "/progress/summary?days=7")).json());
    expect(p.sections.tasks.achieved).toBe(1);
  });
});

describe("flagging an unverified row (SPEC §2.5 rule 8, FR-031)", () => {
  it("records the flag with a note, shows it on the entry and lists it", async () => {
    const id = "synthetic-fixture:grammar:2";
    const res = await send("POST", `/curriculum/items/${encodeURIComponent(id)}/flag`, { note: "Example looks wrong" });
    expect(res.status).toBe(201);
    const detail = curriculumItemDetailResponseSchema.parse(await (await send("GET", `/curriculum/items/${encodeURIComponent(id)}`)).json());
    expect(detail.item.flag?.note).toBe("Example looks wrong");
    const list = flagListResponseSchema.parse(await (await send("GET", "/curriculum/flags")).json());
    expect(list.flags.map((f) => [f.itemId, f.itemType])).toEqual([[id, "grammar"]]);
    await send("DELETE", `/curriculum/items/${encodeURIComponent(id)}/flag`);
    expect(flagListResponseSchema.parse(await (await send("GET", "/curriculum/flags")).json()).flags).toEqual([]);
  });

  it("refuses to flag verified vocabulary", async () => {
    const res = await send("POST", `/curriculum/items/${encodeURIComponent("synthetic-fixture:vocab:1")}/flag`, {});
    expect(res.status).toBe(400);
  });

  it("keeps a flagged grammar point, character and task out of plans and its cards out of review", async () => {
    const before = await plan();
    const grammarId = before.plan.grammar[0]?.itemId ?? "";
    const charId = before.plan.characters[0]?.itemId ?? "";
    const taskId = before.plan.task?.itemId ?? "";
    await finish(before, ["你好。"]);
    for (const id of [grammarId, charId, taskId]) {
      expect((await send("POST", `/curriculum/items/${encodeURIComponent(id)}/flag`, {})).status).toBe(201);
    }
    const cards = dueResponseSchema.parse(await (await send("GET", "/reviews/due?limit=50")).json()).cards;
    expect(cards.some((c) => [grammarId, charId].includes(c.item.id))).toBe(false);
    // Make the flagged grammar due for recycling; it still stays out.
    await database.db.prepare("UPDATE sessions SET local_study_date = date(local_study_date, '-3 day')").run();
    const after = await plan();
    expect(after.plan.grammar.some((g) => g.itemId === grammarId)).toBe(false);
    expect(after.plan.characters.some((c) => c.itemId === charId)).toBe(false);
    expect(after.plan.task?.itemId).not.toBe(taskId);
  });
});
