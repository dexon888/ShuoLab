import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { prepareColloquialImport } from "../../src/server/services/colloquial-import";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { assertPlanTargetsValid, planSession } from "../../src/server/services/sessions";
import { errorEnvelopeSchema } from "../../src/shared/api";
import { getColloquialSource } from "../../src/shared/colloquial";
import { SESSION_MINUTE_OPTIONS } from "../../src/shared/learning";
import {
  TARGET_COUNTS,
  listeningSpeakingShare,
  planResponseSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  type SessionPlan,
} from "../../src/shared/session";
import { colloquialToCsv, makeSyntheticColloquial } from "../fixtures/synthetic-colloquial";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

const app = createApp();

function api(database: TestDatabase, path: string, init: RequestInit = {}) {
  return app.request(`http://localhost/api/v1${path}`, init, {
    DB: database.db,
    APP_ENV: "development",
    DEV_AUTH_BYPASS: "true",
  });
}

function post(database: TestDatabase, body: unknown) {
  return api(database, "/sessions/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function planned(res: Response) {
  expect([200, 201], await res.clone().text()).toContain(res.status);
  return planResponseSchema.parse(await res.json());
}

async function seedVocab(database: TestDatabase) {
  const vocab = prepare([sourceFile("all.csv", toCsv(makeSyntheticRecords()))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
}

async function seedColloquial(database: TestDatabase) {
  const source = getColloquialSource("synthetic-fixture");
  if (!source) throw new Error("no source");
  const result = prepareColloquialImport({
    source,
    file: sourceFile("slang.csv", colloquialToCsv(makeSyntheticColloquial())),
    importedAt: "2026-01-01T00:00:00.000Z",
  });
  if (!result.ok) throw new Error("colloquial fixture rejected");
  await applyStatements(database.db, result.statements);
}

/** Marks every unfinished session complete, as if the day's practice was done. */
async function finishAll(database: TestDatabase) {
  await database.db.prepare("UPDATE sessions SET status = 'complete' WHERE status IN ('planned','active','paused')").run();
}

describe("with no curriculum imported (FR-005)", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  }, 60_000);
  afterAll(async () => {
    await database.dispose();
  });

  it("refuses to plan an HSK session and says what is missing", async () => {
    const res = await post(database, {});
    expect(res.status).toBe(503);
    const { error } = errorEnvelopeSchema.parse(await res.json());
    expect(error.code).toBe("CURRICULUM_MISSING");
    expect(error.message).toMatch(/vocabulary import/);
    const rows = await database.db.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it("still plans an open conversation, with no band, edition or targets", async () => {
    const { session, reused } = await planned(await post(database, { freeChat: true, durationMinutes: 15 }));
    expect(reused).toBe(false);
    expect(session).toMatchObject({ kind: "free_chat", status: "planned", editionId: null, targetBand: null, durationMinutes: 15 });
    expect(session.plan).toMatchObject({ kind: "free_chat", targets: [], grammarIds: [], colloquial: [], bandSource: null });
    expect(session.plan.situation).toMatchObject({ id: "free-chat", sourceType: "app-authored" });
    expect(JSON.stringify(session.plan)).not.toMatch(/hsk3-2025-11|synthetic-fixture/);
  });

  it("lists it as today's resumable session", async () => {
    const list = sessionListResponseSchema.parse(await (await api(database, "/sessions")).json());
    expect(list.sessions).toHaveLength(1);
    expect(list.resumable?.kind).toBe("free_chat");
  });
});

describe("planning with an imported curriculum (FR-006, SPEC §6.2)", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
    await seedVocab(database);
  }, 60_000);
  afterAll(async () => {
    await database.dispose();
  });

  it("requires the owner", async () => {
    const env = { DB: database.db, APP_ENV: "production" };
    const res = await app.request(
      "http://localhost/api/v1/sessions/plan",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );
    expect(res.status).toBe(503);
    expect((await app.request("http://localhost/api/v1/sessions", {}, env)).status).toBe(503);
  });

  it("suggests HSK 1 when no band is chosen, and says it is a suggestion", async () => {
    const res = await post(database, {});
    expect(res.status).toBe(201);
    const { session } = await planned(res);
    expect(session.plan).toMatchObject({
      kind: "hsk",
      editionId: "synthetic-fixture",
      synthetic: true,
      targetBand: "1",
      bandSource: "suggestion",
      durationMinutes: 20,
      grammarIds: [],
    });
    expect(session.plan.localStudyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("persists the edition, goal, real source ids and a time budget", async () => {
    const list = sessionListResponseSchema.parse(await (await api(database, "/sessions")).json());
    const id = list.resumable?.id as string;
    const { session } = sessionResponseSchema.parse(await (await api(database, `/sessions/${id}`)).json());

    expect(session.plan.situation.sourceType).toBe("app-authored");
    expect(session.plan.situation.communicativeGoal.length).toBeGreaterThan(10);
    expect(session.plan.targets).toHaveLength(TARGET_COUNTS[20]);
    expect(session.plan.targets.map((t) => t.itemId)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `synthetic-fixture:vocab:${n}`),
    );
    expect(session.plan.targets.every((t) => t.role === "active" && t.hskBand === "1")).toBe(true);
    expect(session.plan.activities.map((a) => a.kind)).toEqual(["warmup", "introduce", "listen", "notice", "read", "practice", "speak", "write", "summary"]);
    expect(session.plan.activities.reduce((sum, a) => sum + a.minutes, 0)).toBe(20);

    const targets = await database.db
      .prepare("SELECT curriculum_item_id, role, position FROM session_targets WHERE session_id = ?1 ORDER BY position")
      .bind(id)
      .all();
    expect(targets.results).toHaveLength(5);
    expect(targets.results[0]).toEqual({ curriculum_item_id: "synthetic-fixture:vocab:1", role: "active", position: 0 });
  });

  it("returns the same unfinished session when asked again the same day", async () => {
    const first = await planned(await post(database, {}));
    expect(first.reused).toBe(true);
    const again = await post(database, {});
    expect(again.status).toBe(200);
    expect((await planned(again)).session.id).toBe(first.session.id);
    const rows = await database.db.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("replaces a not-yet-started session when a different length or band is asked for", async () => {
    const before = await planned(await post(database, {}));
    const changed = await planned(await post(database, { durationMinutes: 30, studyBand: "2" }));
    expect(changed.reused).toBe(false);
    expect(changed.session.id).not.toBe(before.session.id);
    expect(changed.session.plan).toMatchObject({ targetBand: "2", bandSource: "owner_choice", durationMinutes: 30 });

    const old = await database.db.prepare("SELECT status FROM sessions WHERE id = ?1").bind(before.session.id).first<{ status: string }>();
    expect(old?.status).toBe("abandoned");
    // The abandoned plan is not listed and its entries are free to be planned again.
    const list = sessionListResponseSchema.parse(await (await api(database, "/sessions")).json());
    expect(list.sessions.map((s) => s.id)).toEqual([changed.session.id]);
  });

  it("does not replace a session that has been started", async () => {
    const current = await planned(await post(database, { durationMinutes: 30, studyBand: "2" }));
    await database.db.prepare("UPDATE sessions SET status = 'active' WHERE id = ?1").bind(current.session.id).run();
    const other = await planned(await post(database, { durationMinutes: 15, studyBand: "1" }));
    expect(other.reused).toBe(true);
    expect(other.session.id).toBe(current.session.id);
    expect(other.session.status).toBe("active");
  });

  it("moves on to new entries, adds review and one stretch entry, and rotates the situation", async () => {
    const first = await planned(await post(database, { durationMinutes: 30, studyBand: "2" }));
    await finishAll(database);
    // Words come back two or more days after they were last targeted (SPEC §6.2).
    const sameDay = await planned(await post(database, { durationMinutes: 30, studyBand: "2" }));
    expect(sameDay.session.plan.targets.some((t) => t.role === "review")).toBe(false);
    await database.db.prepare("DELETE FROM sessions WHERE id = ?1").bind(sameDay.session.id).run();
    await database.db.prepare("UPDATE sessions SET local_study_date = date(local_study_date, '-3 day')").run();
    const second = await planned(await post(database, { durationMinutes: 30, studyBand: "2" }));

    const plan = second.session.plan;
    expect(second.reused).toBe(false);
    expect(plan.targets).toHaveLength(8);
    const byRole = (role: string) => plan.targets.filter((t) => t.role === role);
    expect(byRole("review")).toHaveLength(2);
    expect(byRole("stretch")).toHaveLength(1);
    expect(byRole("active")).toHaveLength(5);

    const firstIds = new Set(first.session.plan.targets.map((t) => t.itemId));
    expect(byRole("active").every((t) => !firstIds.has(t.itemId) && t.hskBand === "2")).toBe(true);
    expect(byRole("review").every((t) => firstIds.has(t.itemId))).toBe(true);
    expect(byRole("stretch")[0]?.hskBand).toBe("3");
    expect(plan.levelConstraints).toEqual({ activeBand: "2", stretchBand: "3" });
    expect(new Set(plan.targets.map((t) => t.itemId)).size).toBe(8);
    expect(plan.situation.id).not.toBe(first.session.plan.situation.id);
  });

  it("keeps at least half the targets at the study band and stretch at most 20%, for every length", async () => {
    for (const durationMinutes of SESSION_MINUTE_OPTIONS) {
      await finishAll(database);
      const { session } = await planned(await post(database, { durationMinutes, studyBand: "3" }));
      const { targets, activities } = session.plan;
      expect(targets.length, `${durationMinutes} min`).toBeLessThanOrEqual(TARGET_COUNTS[durationMinutes]);
      expect(targets.filter((t) => t.role === "active").length).toBeLessThanOrEqual(5);
      expect(targets.length).toBeGreaterThanOrEqual(3);
      expect(targets.length).toBeLessThanOrEqual(8);
      expect(targets.filter((t) => t.hskBand === "3" && t.role === "active").length * 2).toBeGreaterThanOrEqual(targets.length);
      expect(targets.filter((t) => t.role === "stretch").length).toBeLessThanOrEqual(targets.length * 0.2);
      expect(activities.reduce((sum, a) => sum + a.minutes, 0)).toBe(durationMinutes);
      expect(listeningSpeakingShare(activities)).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("has no stretch band above the shared 7–9 band", async () => {
    await finishAll(database);
    const { session } = await planned(await post(database, { durationMinutes: 30, studyBand: "7-9" }));
    expect(session.plan.targets.some((t) => t.role === "stretch")).toBe(false);
    expect(session.plan.levelConstraints.stretchBand).toBeNull();
    expect(session.plan.targets.filter((t) => t.role === "active").every((t) => t.hskBand === "7-9")).toBe(true);
  });

  it("is deterministic: the same state and time give the same plan", async () => {
    await finishAll(database);
    const now = new Date("2026-03-04T10:00:00.000Z");
    const a = await planSession(database.db, { durationMinutes: 25, studyBand: "4" }, now);
    await database.db.prepare("DELETE FROM session_targets WHERE session_id = ?1").bind(a.session.id).run();
    await database.db.prepare("DELETE FROM sessions WHERE id = ?1").bind(a.session.id).run();
    const b = await planSession(database.db, { durationMinutes: 25, studyBand: "4" }, now);
    expect(b.session.plan).toEqual(a.session.plan);
    expect(b.session.id).not.toBe(a.session.id);
    await finishAll(database);
  });

  it("uses the owner's time zone for the study date", async () => {
    await api(database, "/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Shanghai", studyBand: "5", sessionMinutes: 15 }),
    });
    // 20:30 UTC on 4 March is already 5 March in Shanghai.
    const { session } = await planSession(database.db, {}, new Date("2026-03-04T20:30:00.000Z"));
    expect(session.localStudyDate).toBe("2026-03-05");
    expect(session.plan).toMatchObject({ targetBand: "5", bandSource: "owner_choice", durationMinutes: 15 });
    await finishAll(database);
  });

  it("includes no colloquial expression when none are imported", async () => {
    const { session } = await planned(await post(database, {}));
    expect(session.plan.colloquial).toEqual([]);
    await finishAll(database);
  });

  it.each([
    ["an unknown field", { durationMinutes: 20, targetItemIds: ["synthetic-fixture:vocab:9999"] }],
    ["a length that is not offered", { durationMinutes: 45 }],
    ["a single level inside 7–9", { studyBand: "8" }],
    ["a non-boolean freeChat", { freeChat: "yes" }],
  ])("rejects %s", async (_name, body) => {
    const res = await post(database, body);
    expect(res.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 for an unknown session and 400 for a malformed id", async () => {
    expect((await api(database, "/sessions/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api(database, "/sessions/nope")).status).toBe(400);
    expect((await api(database, "/sessions?limit=500")).status).toBe(400);
  });
});

describe("plan validation against the database (SPEC §2.4 acceptance, FR-007)", () => {
  let database: TestDatabase;
  let plan: SessionPlan;
  beforeAll(async () => {
    database = await createTestDatabase();
    await seedVocab(database);
    plan = (await planSession(database.db, { durationMinutes: 30, studyBand: "2" })).session.plan;
  }, 60_000);
  afterAll(async () => {
    await database.dispose();
  });

  const withFirst = (change: Partial<SessionPlan["targets"][number]>): SessionPlan => ({
    ...plan,
    targets: plan.targets.map((t, i) => (i === 0 ? { ...t, ...change } : t)),
  });

  it("accepts the planner's own plan", async () => {
    await expect(assertPlanTargetsValid(database.db, plan)).resolves.toBeUndefined();
  });

  it("rejects an entry claimed for HSK 2 that the syllabus places in another band", async () => {
    // Entry 9999 exists, but in the 7–9 band.
    const tampered = withFirst({ itemId: "synthetic-fixture:vocab:9999", sourceId: 9999, hskBand: "2" });
    await expect(assertPlanTargetsValid(database.db, tampered)).rejects.toThrow(/differs from the imported syllabus/);
  });

  it("rejects an entry that was never imported", async () => {
    const tampered = withFirst({ itemId: "synthetic-fixture:vocab:99999" });
    await expect(assertPlanTargetsValid(database.db, tampered)).rejects.toThrow(/not in the imported syllabus/);
  });

  it("rejects an entry from another edition", async () => {
    const tampered = withFirst({ itemId: "hsk3-2025-11:vocab:301" });
    await expect(assertPlanTargetsValid(database.db, tampered)).rejects.toThrow(/not in the imported syllabus/);
  });

  it("rejects a new target outside the study band, even with its true band stated", async () => {
    const tampered = withFirst({ itemId: "synthetic-fixture:vocab:9999", sourceId: 9999, hskBand: "7-9" });
    await expect(assertPlanTargetsValid(database.db, tampered)).rejects.toThrow(/not in the session's study band/);
  });

  it("rejects repeated targets and syllabus targets on an open conversation", async () => {
    const repeated = { ...plan, targets: [...plan.targets, plan.targets[0] as SessionPlan["targets"][number]] };
    await expect(assertPlanTargetsValid(database.db, repeated)).rejects.toThrow(/empty or repeated/);
    const chat: SessionPlan = { ...plan, kind: "free_chat" };
    await expect(assertPlanTargetsValid(database.db, chat)).rejects.toThrow(/cannot carry syllabus targets/);
  });

  it("the database refuses a target row for an entry that does not exist", async () => {
    const id = (await database.db.prepare("SELECT id FROM sessions LIMIT 1").first<{ id: string }>())?.id as string;
    await expect(
      database.db
        .prepare("INSERT INTO session_targets (session_id, curriculum_item_id, role, position) VALUES (?1, 'synthetic-fixture:vocab:99999', 'active', 99)")
        .bind(id)
        .run(),
    ).rejects.toThrow();
  });
});

describe("colloquial expression in a plan (SPEC §6.2 step 4)", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
    await seedVocab(database);
    await seedColloquial(database);
  }, 60_000);
  afterAll(async () => {
    await database.dispose();
  });

  const setIntensity = (slangIntensity: string) =>
    api(database, "/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slangIntensity }),
    });

  it("adds at most one, kept apart from the HSK targets, at normal intensity", async () => {
    const { session } = await planned(await post(database, {}));
    expect(session.plan.colloquial).toHaveLength(1);
    const pick = session.plan.colloquial[0];
    expect(pick?.id).toMatch(/^colloquial:/);
    expect(pick?.synthetic).toBe(true);
    expect(session.plan.targets.some((t) => t.itemId.startsWith("colloquial:"))).toBe(false);
    // Normal intensity never picks typed-only, fading or swear-level expressions.
    const row = await database.db
      .prepare("SELECT register, channel, currency_status FROM colloquial_expressions WHERE id = ?1")
      .bind(pick?.id)
      .first<{ register: string; channel: string; currency_status: string }>();
    expect(row).toMatchObject({ channel: "both", currency_status: "steady" });
    expect(["neutral", "casual"]).toContain(row?.register);
    await finishAll(database);
  });

  it("adds none at low intensity", async () => {
    await setIntensity("low");
    const { session } = await planned(await post(database, {}));
    expect(session.plan.colloquial).toEqual([]);
    await finishAll(database);
  });

  it("never picks a swear-level expression, even at high intensity", async () => {
    await setIntensity("high");
    for (let i = 0; i < 12; i++) {
      const { session } = await planned(await post(database, { durationMinutes: 20 }));
      const pick = session.plan.colloquial[0];
      expect(pick).toBeDefined();
      const row = await database.db
        .prepare("SELECT register FROM colloquial_expressions WHERE id = ?1")
        .bind(pick?.id)
        .first<{ register: string }>();
      expect(row?.register).not.toBe("very_informal");
      await finishAll(database);
    }
  }, 60_000);
});
