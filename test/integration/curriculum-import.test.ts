import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import {
  applyStatements,
  renderSqlScript,
  verifyDatabase,
  type QueryFn,
} from "../../src/server/services/curriculum-import";
import { curriculumStatusResponseSchema, meResponseSchema } from "../../src/shared/api";
import { ACTIVE_EDITION_ID, SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import { makeSyntheticRecords, toCsv } from "../fixtures/synthetic-vocab";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";
import { prepare, sourceFile } from "../helpers/import";

const records = makeSyntheticRecords();
const csv = toCsv(records);

let database: TestDatabase;
let query: QueryFn;

beforeEach(async () => {
  database = await createTestDatabase();
  query = async (sql) => (await database.db.prepare(sql).all<Record<string, unknown>>()).results;
});

afterEach(async () => {
  await database.dispose();
});

async function count(table: string, where = "1 = 1"): Promise<number> {
  const [row] = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return Number(row?.n);
}

async function importSynthetic(editionId = SYNTHETIC_EDITION_ID, importedAt?: string) {
  const result = prepare([sourceFile("all.csv", csv)], editionId, importedAt);
  if (!result.ok) throw new Error(`fixture rejected: ${JSON.stringify(result.issues.slice(0, 3))}`);
  await applyStatements(database.db, result.statements);
  return result;
}

async function status() {
  const app = createApp();
  const env = { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true" };
  const res = await app.request("http://localhost/api/v1/curriculum/status", {}, env);
  const me = await app.request("http://localhost/api/v1/me", {}, env);
  return {
    status: curriculumStatusResponseSchema.parse(await res.json()),
    me: meResponseSchema.parse(await me.json()),
  };
}

describe("importing into D1 (FR-003)", () => {
  it("stores exactly 11,000 entries with the published count in every band", async () => {
    await importSynthetic();

    expect(await count("curriculum_items")).toBe(11000);
    const bands = await query(
      "SELECT hsk_band AS band, COUNT(*) AS n FROM curriculum_items GROUP BY hsk_band ORDER BY MIN(source_id)",
    );
    expect(bands).toEqual([
      { band: "1", n: 300 },
      { band: "2", n: 200 },
      { band: "3", n: 500 },
      { band: "4", n: 1000 },
      { band: "5", n: 1600 },
      { band: "6", n: 1800 },
      { band: "7-9", n: 5600 },
    ]);

    const report = await verifyDatabase(query);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.synthetic).toBe(true);
    expect(report.dimensions.map((d) => [d.itemType, d.status])).toEqual([
      ["vocab", "verified"],
      ["grammar", "missing"],
      ["character", "missing"],
      ["topic", "missing"],
      ["task", "missing"],
    ]);
  });

  it("stores each row's source fields and records a manifest with checksum and mapping version", async () => {
    const result = await importSynthetic();

    const [homograph] = await query("SELECT * FROM curriculum_items WHERE source_id = 11");
    expect(homograph).toMatchObject({
      id: "synthetic-fixture:vocab:11",
      edition_id: "synthetic-fixture",
      item_type: "vocab",
      hsk_band: "1",
      hanzi: "样例同形词",
      entry_raw: "样例同形词2",
      homograph: "2",
      level_label: "1",
      source_pdf_page: 80,
      definition: null,
      definition_provenance: null,
    });
    expect(await count("curriculum_items", "hanzi = '样例同形词'")).toBe(2);

    const manifests = await query("SELECT * FROM source_manifests");
    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toMatchObject({
      edition_id: "synthetic-fixture",
      dataset_kind: "vocab",
      sha256: result.summary.files[0]?.sha256,
      field_mapping_version: "vocab-v1",
      verification_status: "verified",
      record_count: 11000,
      commit_sha: null,
    });
    expect(String(manifests[0]?.sha256)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent: re-running the same import changes nothing and duplicates nothing", async () => {
    await importSynthetic();
    const before = await query("SELECT * FROM curriculum_items ORDER BY source_id");
    await importSynthetic();
    await importSynthetic();
    const after = await query("SELECT * FROM curriculum_items ORDER BY source_id");

    expect(after).toHaveLength(11000);
    expect(after).toEqual(before);
    expect(await count("source_manifests")).toBe(1);
    expect(await count("curriculum_editions")).toBe(1);
  }, 30_000); // Three full 11,000-row imports.

  it("does not overwrite a separately sourced definition on re-import", async () => {
    await importSynthetic();
    await database.db
      .prepare(
        "UPDATE curriculum_items SET definition = 'placeholder gloss', definition_provenance = 'test lexicon' WHERE source_id = 3",
      )
      .run();
    await importSynthetic();
    const [row] = await query("SELECT definition, definition_provenance FROM curriculum_items WHERE source_id = 3");
    expect(row).toEqual({ definition: "placeholder gloss", definition_provenance: "test lexicon" });
  });

  it("records a changed source file as a new manifest instead of rewriting history", async () => {
    await importSynthetic();
    const changed = toCsv(records.map((r) => (r.id === 9 ? { ...r, part_of_speech: "动" } : r)));
    const result = prepare([sourceFile("all.csv", changed)], SYNTHETIC_EDITION_ID, "2026-02-01T00:00:00.000Z");
    if (!result.ok) throw new Error("expected valid import");
    await applyStatements(database.db, result.statements);

    expect(await count("source_manifests")).toBe(2);
    expect(await count("curriculum_items")).toBe(11000);
    const [row] = await query("SELECT part_of_speech FROM curriculum_items WHERE source_id = 9");
    expect(row?.part_of_speech).toBe("动");
  });
});

describe("atomic failure (FR-004)", () => {
  it("writes nothing when the dataset is rejected", async () => {
    const tampered = toCsv(records.map((r) => (r.id === 5 ? { ...r, level: "2" } : r)));
    const result = prepare([sourceFile("all.csv", tampered)]);
    expect(result.ok).toBe(false);
    expect(await count("curriculum_items")).toBe(0);
    expect(await count("curriculum_editions")).toBe(0);
    expect(await count("source_manifests")).toBe(0);
  });

  it("rolls back every row if any statement in the write fails", async () => {
    const result = prepare([sourceFile("all.csv", csv)]);
    if (!result.ok) throw new Error("expected valid import");
    const failing = [
      ...result.statements,
      // Violates the hsk_band CHECK constraint, after all 11,000 rows were inserted.
      {
        sql: "INSERT INTO curriculum_items (id, edition_id, source_id, item_type, hsk_band, hanzi) VALUES (?1, ?2, 99999, 'vocab', '8', '样')",
        params: ["synthetic-fixture:vocab:99999", SYNTHETIC_EDITION_ID],
      },
    ];
    await expect(applyStatements(database.db, failing)).rejects.toThrow();

    expect(await count("curriculum_items")).toBe(0);
    expect(await count("curriculum_editions")).toBe(0);
    expect(await count("source_manifests")).toBe(0);
  });

  it("leaves an existing good import intact when a later import fails mid-write", async () => {
    await importSynthetic();
    const changed = toCsv(records.map((r) => ({ ...r, pinyin: "changed" })));
    const result = prepare([sourceFile("all.csv", changed)]);
    if (!result.ok) throw new Error("expected valid import");
    const failing = [...result.statements, { sql: "INSERT INTO no_such_table VALUES (1)", params: [] }];
    await expect(applyStatements(database.db, failing)).rejects.toThrow();

    expect(await count("curriculum_items", "pinyin = 'changed'")).toBe(0);
    expect(await count("curriculum_items")).toBe(11000);
    expect((await verifyDatabase(query)).ok).toBe(true);
  });
});

describe("edition history and isolation (SPEC §2.2 #7)", () => {
  it("keeps both editions' rows and makes the newest import the only active edition", async () => {
    await importSynthetic(SYNTHETIC_EDITION_ID);
    // The synthetic rows stand in for the real file here; only the edition id differs.
    await importSynthetic(ACTIVE_EDITION_ID);

    expect(await count("curriculum_items")).toBe(22000);
    expect(await count("curriculum_items", `edition_id = '${SYNTHETIC_EDITION_ID}'`)).toBe(11000);
    expect(await count("curriculum_items", `edition_id = '${ACTIVE_EDITION_ID}'`)).toBe(11000);
    expect(await query("SELECT id FROM curriculum_editions WHERE is_active = 1")).toEqual([
      { id: ACTIVE_EDITION_ID },
    ]);

    const report = await verifyDatabase(query);
    expect(report).toMatchObject({ ok: true, editionId: ACTIVE_EDITION_ID, synthetic: false });
  });
});

describe("verifyDatabase", () => {
  it("fails on an empty database", async () => {
    const report = await verifyDatabase(query);
    expect(report.ok).toBe(false);
    expect(report.editionId).toBeNull();
  });

  it("fails when a row is deleted, added out of range, or re-banded after import", async () => {
    await importSynthetic();
    await database.db.prepare("DELETE FROM curriculum_items WHERE source_id = 400").run();
    let report = await verifyDatabase(query);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "Numbered entries 1–11000 are all present",
      "Each band has the published number of new entries",
    ]);
    expect(report.dimensions[0]).toMatchObject({ itemType: "vocab", status: "imported" });

    await importSynthetic();
    await database.db.prepare("UPDATE curriculum_items SET hsk_band = '6' WHERE source_id = 1").run();
    report = await verifyDatabase(query);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "Each band has the published number of new entries",
    ]);
  });

  it("fails when rows exist without a verified manifest, even if every count matches", async () => {
    await importSynthetic();
    await database.db.prepare("DELETE FROM source_manifests").run();

    const report = await verifyDatabase(query);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "A verified source manifest is recorded",
    ]);

    const api = await status();
    expect(api.status.dimensions[0]).toMatchObject({ itemType: "vocab", status: "imported", importedCount: 11000 });
    expect(api.me.curriculumImported).toBe(false);
  });

  it("flags a definition that has no provenance", async () => {
    await importSynthetic();
    await database.db.prepare("UPDATE curriculum_items SET definition = 'gloss' WHERE source_id = 2").run();
    const report = await verifyDatabase(query);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["No definition lacks provenance"]);
  });
});

describe("status API after import", () => {
  it("reports verified vocabulary, flags synthetic data, and exposes the manifest", async () => {
    await importSynthetic();
    const api = await status();

    expect(api.status.activeEdition).toMatchObject({ id: SYNTHETIC_EDITION_ID, synthetic: true });
    expect(api.status.dimensions[0]).toMatchObject({ itemType: "vocab", status: "verified", importedCount: 11000 });
    expect(api.status.dimensions.slice(1).every((d) => d.status === "missing")).toBe(true);
    expect(api.status.vocabByBand.every((b) => b.importedNew === b.expectedNew)).toBe(true);
    expect(api.status.manifests).toHaveLength(1);
    expect(api.status.manifests[0]).toMatchObject({
      datasetKind: "vocab",
      verificationStatus: "verified",
      fieldMappingVersion: "vocab-v1",
      recordCount: 11000,
    });
    expect(api.me.curriculumImported).toBe(true);
  });
});

describe("SQL script for the deployed database", () => {
  it("produces the same verified result as the bound-parameter import", async () => {
    const result = prepare([sourceFile("all.csv", csv)]);
    if (!result.ok) throw new Error("expected valid import");
    const script = renderSqlScript(result.statements);

    // One statement per line, each within D1's 100 kB statement limit.
    const lines = script.trimEnd().split("\n");
    expect(lines).toHaveLength(result.statements.length);
    expect(Math.max(...lines.map((l) => new TextEncoder().encode(l).length))).toBeLessThan(100_000);

    await database.db.exec(script);
    expect((await verifyDatabase(query)).ok).toBe(true);
    const [row] = await query("SELECT hanzi, entry_raw, level_label FROM curriculum_items WHERE source_id = 50");
    expect(row).toEqual({ hanzi: "样例词50", entry_raw: "样例词50", level_label: "1（2）" });
  });
});
