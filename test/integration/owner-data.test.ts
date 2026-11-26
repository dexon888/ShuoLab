import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { FakeTutorProvider } from "../../src/server/providers/fake";
import { applyStatements } from "../../src/server/services/curriculum-import";
import { applyRetention, csvField, importOwnerData } from "../../src/server/services/owner-data";
import { listDue, rateCard } from "../../src/server/services/review";
import { errorEnvelopeSchema } from "../../src/shared/api";
import {
  DELETE_ALL_PHRASE,
  OWNER_TABLES,
  dataSummaryResponseSchema,
  deletionResponseSchema,
  exportDocumentSchema,
  type ExportDocument,
} from "../../src/shared/owner-data";
import { listeningResponseSchema } from "../../src/shared/listening";
import { planResponseSchema } from "../../src/shared/session";
import { settingsResponseSchema } from "../../src/shared/settings";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and the local stand-in tutor.
const app = createApp({ tutor: () => new FakeTutorProvider() });

function client(database: TestDatabase) {
  const env = { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" };
  return (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(
      `http://localhost/api/v1${path}`,
      { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
}

async function withCurriculum(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  const vocab = prepare([sourceFile("all.csv", toCsv(makeSyntheticRecords()))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
  return database;
}

/** A session with turns, a listening exercise, review ratings and settings. */
async function fillWithHistory(database: TestDatabase) {
  const send = client(database);
  await send("PUT", "/settings", { nickname: "小明", timezone: "Asia/Shanghai", sessionMinutes: 25 });
  const { session } = planResponseSchema.parse(await (await send("POST", "/sessions/plan", { durationMinutes: 30, studyBand: "2" })).json());
  for (const text of ["你好，我想说“逗号,引号\"”。", "第二句\n换行。"]) {
    await send("POST", `/sessions/${session.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript: text, sourceMode: "typed" });
  }
  const listening = listeningResponseSchema.parse(await (await send("POST", `/sessions/${session.id}/listening`, {})).json());
  await send("POST", `/sessions/${session.id}/listening/answers`, { answers: listening.exercise.questions.map(() => 0) });
  await send("POST", `/sessions/${session.id}/complete`, {});
  const cards = (await listDue(database.db, 50)).cards;
  for (const card of cards.slice(0, 3)) await rateCard(database.db, card.id, { rating: "good", clientEventId: crypto.randomUUID() });
  return session;
}

async function exportOf(database: TestDatabase): Promise<ExportDocument> {
  const res = await client(database)("GET", "/export?format=json");
  expect(res.status, await res.clone().text()).toBe(200);
  return exportDocumentSchema.parse(await res.json());
}

const count = async (database: TestDatabase, table: string) =>
  (await database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

let source: TestDatabase;
let target: TestDatabase;

beforeAll(async () => {
  [source, target] = await Promise.all([withCurriculum(), withCurriculum()]);
  await fillWithHistory(source);
}, 120_000);

afterAll(async () => {
  await Promise.all([source.dispose(), target.dispose()]);
});

describe("export (FR-019, SEC-05)", () => {
  it("downloads every owner table as versioned JSON, never cached, without reference data", async () => {
    const res = await client(source)("GET", "/export?format=json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="shuolab-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const doc = exportDocumentSchema.parse(await res.json());
    expect(Object.keys(doc.tables)).toEqual([...OWNER_TABLES]);
    expect(doc.curriculumEditions).toEqual(["synthetic-fixture"]);
    for (const table of OWNER_TABLES) expect(doc.tables[table].length, table).toBe(await count(source, table));
    expect(doc.tables.conversation_turns.length).toBeGreaterThan(0);
    expect(doc.tables.review_events).toHaveLength(3);
    expect(JSON.stringify(doc)).not.toMatch(/curriculum_items|sk-[A-Za-z0-9]/);
  });

  it("exports one table as CSV that a spreadsheet reads, quoting commas, quotes and line breaks", async () => {
    const res = await client(source)("GET", "/export?format=csv&table=conversation_turns");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/filename="shuolab-conversation_turns-/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // UTF-8 byte-order mark, which text() would strip.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text).toContain('"你好，我想说“逗号,引号""”。"');
    expect(text).toContain('"第二句\n换行。"');
    // The first character is the byte-order mark; the header follows it.
    expect(text.split("\r\n")[0]?.slice(1)).toMatch(/^id,session_id,client_turn_id,/);
    expect([csvField(null), csvField(3), csvField("a,b"), csvField('say "hi"')]).toEqual(["", "3", '"a,b"', '"say ""hi"""']);
  });

  it("refuses unknown formats and tables", async () => {
    const send = client(source);
    for (const q of ["format=xml", "format=csv", "format=csv&table=curriculum_items", ""]) {
      expect((await send("GET", `/export?${q}`)).status, q).toBe(400);
    }
  });
});

describe("re-import round trip (FR-019)", () => {
  it("loads an export into a fresh database, which then exports the same data", async () => {
    const original = await exportOf(source);
    const { inserted } = await importOwnerData(target.db, original);
    expect(inserted.sessions).toBe(1);
    const again = await exportOf(target);
    expect(again.tables).toEqual(original.tables);
    // The re-imported history still works: due cards and settings come back.
    expect((await listDue(target.db, 50)).totalCards).toBe(await count(source, "review_cards"));
    const settings = settingsResponseSchema.parse(await (await client(target)("GET", "/settings")).json());
    expect(settings.settings).toMatchObject({ nickname: "小明", timezone: "Asia/Shanghai", sessionMinutes: 25 });
  });

  it("refuses to import over existing data, without changing anything", async () => {
    const doc = await exportOf(source);
    await expect(importOwnerData(target.db, doc)).rejects.toThrow(/already holds data/);
  });

  it("refuses files that are not exports, unknown columns, and data for a missing edition", async () => {
    const fresh = await createTestDatabase();
    try {
      const doc = await exportOf(source);
      await expect(importOwnerData(fresh.db, { hello: "world" })).rejects.toThrow(/not a ShuoLab export/);
      await expect(importOwnerData(fresh.db, { ...doc, schemaVersion: 2 })).rejects.toThrow(/not a ShuoLab export/);
      // No curriculum in this database.
      await expect(importOwnerData(fresh.db, doc)).rejects.toThrow(/Import the curriculum edition synthetic-fixture first/);
      const injected = structuredClone(doc);
      injected.curriculumEditions = [];
      injected.tables.owner_settings = [{ ...injected.tables.owner_settings[0], "owner_id) VALUES ('x'); --": "x" }];
      await expect(importOwnerData(fresh.db, injected)).rejects.toThrow(/does not know/);
      expect(await count(fresh, "owner_settings")).toBe(0);
    } finally {
      await fresh.dispose();
    }
  }, 60_000);
});

describe("deletion (SPEC §8.4, SEC-06)", () => {
  it("deletes one session and its conversation, keeping review history and the usage ledger", async () => {
    const db = await withCurriculum();
    try {
      const session = await fillWithHistory(db);
      const send = client(db);
      const cards = await count(db, "review_cards");
      const usage = await count(db, "usage_events");
      const res = await send("DELETE", `/sessions/${session.id}`);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = deletionResponseSchema.parse(await res.json());
      expect(body.deleted).toMatchObject({ sessions: 1, conversation_turns: 2, listening_exercises: 1 });
      expect(await count(db, "conversation_turns")).toBe(0);
      expect(await count(db, "listening_exercises")).toBe(0);
      expect(await count(db, "review_cards")).toBe(cards);
      expect(await count(db, "usage_events")).toBe(usage);
      expect(await count(db, "curriculum_items")).toBe(11000);
      expect((await send("GET", `/sessions/${session.id}`)).status).toBe(404);
      expect((await send("DELETE", `/sessions/${session.id}`)).status).toBe(404);
      expect((await send("DELETE", "/sessions/not-an-id")).status).toBe(400);
    } finally {
      await db.dispose();
    }
  }, 60_000);

  it("deletes everything of the owner's only with the exact phrase, keeping this month's spending and the curriculum", async () => {
    const db = await withCurriculum();
    try {
      await fillWithHistory(db);
      const send = client(db);
      await db.db
        .prepare("INSERT INTO usage_events (id, provider, operation, status, recorded_at) VALUES ('old', 'x', 'tutor_turn', 'ok', '2020-01-01T00:00:00.000Z')")
        .run();
      const thisMonth = (await count(db, "usage_events")) - 1;

      expect((await send("DELETE", "/my-data", { confirm: "delete my data" })).status).toBe(400);
      expect((await send("DELETE", "/my-data", { confirm: DELETE_ALL_PHRASE }, { Origin: "https://evil.example" })).status).toBe(403);
      expect(await count(db, "sessions")).toBe(1);

      const res = await send("DELETE", "/my-data", { confirm: DELETE_ALL_PHRASE });
      expect(res.status).toBe(200);
      const body = deletionResponseSchema.parse(await res.json());
      expect(body.deleted).toMatchObject({ sessions: 1, usage_events: 1, owner_settings: 1 });
      expect(body.kept.join(" ")).toMatch(/This month's usage ledger/);
      for (const table of OWNER_TABLES.filter((t) => t !== "usage_events")) expect(await count(db, table), table).toBe(0);
      expect(await count(db, "usage_events")).toBe(thisMonth);
      expect(await count(db, "curriculum_items")).toBe(11000);
      const summary = dataSummaryResponseSchema.parse(await (await send("GET", "/my-data")).json());
      expect(summary.counts.sessions).toBe(0);
      // Settings are back to their defaults.
      expect(settingsResponseSchema.parse(await (await send("GET", "/settings")).json()).settings.onboardedAt).toBeNull();
    } finally {
      await db.dispose();
    }
  }, 60_000);
});

describe("transcript retention (SEC-03, PRIV-01)", () => {
  it("removes conversation text of finished sessions past the period, keeping the session and its evidence", async () => {
    const db = await withCurriculum();
    try {
      const session = await fillWithHistory(db);
      const send = client(db);
      expect(await applyRetention(db.db)).toBe(0);

      // Move the finished session 40 days back.
      const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
      await db.db.prepare("UPDATE sessions SET local_study_date = ?1 WHERE id = ?2").bind(old, session.id).run();
      const attempts = await count(db, "practice_attempts");

      const res = await send("PUT", "/settings", { transcriptRetentionDays: 30 });
      expect(res.status).toBe(200);
      expect(await count(db, "conversation_turns")).toBe(0);
      expect(await count(db, "sessions")).toBe(1);
      expect(await count(db, "listening_exercises")).toBe(1);
      expect(await count(db, "practice_attempts")).toBe(attempts);
      const summary = dataSummaryResponseSchema.parse(await (await send("GET", "/my-data")).json());
      expect(summary).toMatchObject({ transcriptRetentionDays: 30, sessionsPastRetention: 1 });

      expect((await send("PUT", "/settings", { transcriptRetentionDays: 45 })).status).toBe(400);
      expect((await send("PUT", "/settings", { transcriptRetentionDays: null })).status).toBe(200);
    } finally {
      await db.dispose();
    }
  }, 60_000);

  it("never touches an unfinished session, however old", async () => {
    const db = await withCurriculum();
    try {
      const send = client(db);
      const { session } = planResponseSchema.parse(await (await send("POST", "/sessions/plan", { durationMinutes: 15, freeChat: true })).json());
      await send("POST", `/sessions/${session.id}/turn`, { clientTurnId: crypto.randomUUID(), transcript: "你好。", sourceMode: "typed" });
      await db.db.prepare("UPDATE sessions SET local_study_date = '2020-01-01' WHERE id = ?1").bind(session.id).run();
      await send("PUT", "/settings", { transcriptRetentionDays: 30 });
      expect(await count(db, "conversation_turns")).toBe(1);
    } finally {
      await db.dispose();
    }
  }, 60_000);
});

describe("requests that are refused", () => {
  it("answers deletion errors in the usual envelope", async () => {
    const res = await client(source)("DELETE", "/my-data", {});
    expect(errorEnvelopeSchema.parse(await res.json()).error.message).toContain(DELETE_ALL_PHRASE);
  });
});
