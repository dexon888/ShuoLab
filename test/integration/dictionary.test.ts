import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import { applyStatements, verifyDatabase, type QueryFn } from "../../src/server/services/curriculum-import";
import { glossStatements, matchGlosses, parseCedict } from "../../src/server/services/dictionary";
import { curriculumItemDetailResponseSchema, curriculumItemsResponseSchema } from "../../src/shared/api";
import { SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import { sessionStateResponseSchema } from "../../src/shared/debrief";
import { planResponseSchema } from "../../src/shared/session";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

// SYNTHETIC placeholder vocabulary and dictionary lines: not HSK content, not real meanings.
let database: TestDatabase;
let query: QueryFn;
const app = createApp();
const send = (method: string, path: string, body?: unknown) =>
  app.request(`http://localhost/api/v1${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" });
const records = makeSyntheticRecords();

beforeAll(async () => {
  database = await createTestDatabase();
  query = async (sql) => (await database.db.prepare(sql).all<Record<string, unknown>>()).results;
  const vocab = prepare([sourceFile("all.csv", toCsv(records))]);
  if (!vocab.ok) throw new Error("vocab fixture rejected");
  await applyStatements(database.db, vocab.statements);
  const lines = records.slice(0, 20).map((r) => `${r.hanzi} ${r.hanzi} [yang4 li4] /placeholder meaning ${r.id}/`).join("\n");
  const rows = records.map((r) => ({ id: `${SYNTHETIC_EDITION_ID}:vocab:${r.id}`, hanzi: r.hanzi, pinyin: r.pinyin }));
  const match = matchGlosses(rows, parseCedict(lines).entries);
  await applyStatements(database.db, glossStatements(SYNTHETIC_EDITION_ID, match.glosses, { name: "cedict_ts.u8", sha256: "a".repeat(64) }, "2026-11-27T00:00:00.000Z"));
}, 60_000);

afterAll(async () => {
  await database.dispose();
});

describe("sourced meanings in the app (SPEC §2.6 rule 2, FR-033)", () => {
  it("stores each meaning with its provenance and keeps the vocabulary verified", async () => {
    const report = await verifyDatabase(query);
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "No definition lacks provenance")?.ok).toBe(true);
    const manifest = await database.db.prepare("SELECT verification_status, record_count FROM source_manifests WHERE dataset_kind = 'dictionary'").first();
    expect(manifest).toEqual({ verification_status: "unverified", record_count: 20 });
  });

  it("shows the meaning on the entry page and a short meaning in the band list", async () => {
    const detail = curriculumItemDetailResponseSchema.parse(await (await send("GET", `/curriculum/items/${encodeURIComponent(`${SYNTHETIC_EDITION_ID}:vocab:1`)}`)).json());
    expect(detail.item.definition).toBe("placeholder meaning 1");
    expect(detail.item.definitionProvenance).toMatch(/^CC-CEDICT/);
    const list = curriculumItemsResponseSchema.parse(await (await send("GET", "/curriculum/items?band=1")).json());
    expect(list.items[0]?.note).toBe("placeholder meaning 1");
  });

  it("sends a session's meanings with the session", async () => {
    const plan = planResponseSchema.parse(await (await send("POST", "/sessions/plan", { durationMinutes: 20, studyBand: "1" })).json()).session;
    const state = sessionStateResponseSchema.parse(await (await send("GET", `/sessions/${plan.id}`)).json());
    const first = plan.plan.targets[0]?.itemId ?? "";
    expect(state.glosses[first]?.definition).toMatch(/^placeholder meaning /);
    expect(state.glosses[first]?.provenance).toMatch(/Not HSK content/);
  });
});
