/**
 * Export, re-import, deletion and transcript retention for the owner's own
 * data (SPEC §5.7, §8.4; FR-019, SEC-03, SEC-05, SEC-06, PRIV-01). Curriculum
 * and colloquial reference tables are never touched here.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  OWNER_TABLES,
  exportDocumentSchema,
  type DataSummaryResponse,
  type DeletionResponse,
  type ExportDocument,
  type OwnerTable,
} from "../../shared/owner-data";
import { localStudyDate } from "../../shared/session";
import { APP_VERSION } from "../env";
import { ApiError } from "../validation/errors";
import { getSettings } from "./settings";
import { utcMonthBounds } from "./usage";

type Cell = string | number | null;
type Row = Record<string, Cell>;

/** Stable order for each table, so two exports of the same data are identical. */
const ORDER: Readonly<Record<OwnerTable, string>> = {
  owner_settings: "owner_id",
  sessions: "created_at, id",
  session_targets: "session_id, position",
  session_items: "session_id, position",
  session_materials: "created_at, session_id",
  conversation_turns: "session_id, created_at, id",
  listening_exercises: "created_at, id",
  review_cards: "created_at, id",
  review_events: "created_at, id",
  practice_attempts: "attempted_at, id",
  mastery_states: "curriculum_item_id, skill",
  usage_events: "recorded_at, id",
};

async function rows(d1: D1Database, table: OwnerTable): Promise<Row[]> {
  // Table names come from the fixed list above, never from a request.
  const result = await d1.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER[table]}`).all<Row>();
  return result.results;
}

export async function exportJson(d1: D1Database, now: Date = new Date()): Promise<ExportDocument> {
  const entries = await Promise.all(OWNER_TABLES.map(async (t) => [t, await rows(d1, t)] as const));
  const tables = Object.fromEntries(entries) as Record<OwnerTable, Row[]>;
  const editions = new Set<string>();
  for (const s of tables.sessions) if (typeof s.edition_id === "string") editions.add(s.edition_id);
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    curriculumEditions: [...editions].sort(),
    notes: [
      "Your settings, sessions, conversations, listening exercises, review history, evidence and the usage ledger, as stored.",
      "Curriculum and colloquial reference data are not included; re-importing needs the same curriculum edition imported first.",
      "No provider key or token is stored by ShuoLab, so none can appear here.",
    ],
    tables,
  };
}

/** One RFC 4180 field: quoted when it holds a comma, quote or line break. */
export function csvField(value: Cell): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Marks the file as UTF-8 for spreadsheet programs. */
const BOM = String.fromCharCode(0xfeff);
/** CSV rows end with CR LF (RFC 4180). */
const CRLF = String.fromCharCode(13, 10);

/** One table as CSV, with a BOM so spreadsheet programs read the Chinese correctly. */
export async function exportCsv(d1: D1Database, table: OwnerTable): Promise<string> {
  const data = await rows(d1, table);
  const columns = data[0] ? Object.keys(data[0]) : await columnNames(d1, table);
  const lines = [columns.map(csvField).join(","), ...data.map((r) => columns.map((c) => csvField(r[c] ?? null)).join(","))];
  return `${BOM}${lines.join(CRLF)}${CRLF}`;
}

async function columnNames(d1: D1Database, table: OwnerTable): Promise<string[]> {
  const info = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return info.results.map((c) => c.name);
}

// --- Import --------------------------------------------------------------------

export interface ImportResult {
  inserted: Record<OwnerTable, number>;
}

/**
 * Loads an export into a database that holds none of the owner's data yet,
 * all in one batch: either every row goes in or none does. Column names are
 * checked against the real table, and values are always bound, never pasted
 * into the SQL. Meant for local testing and recovery (FR-019).
 */
export async function importOwnerData(d1: D1Database, input: unknown): Promise<ImportResult> {
  const parsed = exportDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("BAD_REQUEST", `This is not a ShuoLab export of schema version ${EXPORT_SCHEMA_VERSION}.`);
  }
  const doc = parsed.data;

  for (const table of OWNER_TABLES.filter((t) => t !== "owner_settings")) {
    const existing = await d1.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) {
      throw new ApiError("CONFLICT", `The database already holds data in ${table}. Import only into a fresh database.`);
    }
  }
  for (const edition of doc.curriculumEditions) {
    const found = await d1.prepare("SELECT 1 AS ok FROM curriculum_editions WHERE id = ?1").bind(edition).first();
    if (!found) throw new ApiError("CONFLICT", `Import the curriculum edition ${edition} first; this data refers to it.`);
  }

  const statements: D1PreparedStatement[] = [d1.prepare("DELETE FROM owner_settings")];
  const inserted = {} as Record<OwnerTable, number>;
  for (const table of OWNER_TABLES) {
    const allowed = new Set(await columnNames(d1, table));
    const list = doc.tables[table];
    inserted[table] = list.length;
    for (const row of list) {
      const columns = Object.keys(row);
      const unknown = columns.find((c) => !allowed.has(c));
      if (unknown) throw new ApiError("BAD_REQUEST", `The export has a column ${table}.${unknown} that this version does not know.`);
      const placeholders = columns.map((_, i) => `?${i + 1}`).join(", ");
      statements.push(
        d1.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).bind(...columns.map((c) => row[c] ?? null)),
      );
    }
  }
  try {
    await d1.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new ApiError(
      "CONFLICT",
      /FOREIGN KEY/i.test(message)
        ? "The export refers to curriculum entries this database does not have. Import the same curriculum edition first."
        : "The export could not be loaded; nothing was written.",
    );
  }
  return { inserted };
}

// --- Deletion ------------------------------------------------------------------

async function counts(d1: D1Database, tables: readonly OwnerTable[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const t of tables) result[t] = (await d1.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n ?? 0;
  return result;
}

/**
 * Deletes one session with its turns, targets, listening exercise and the
 * attempts made in it. Review cards and their history stay: they belong to
 * the words, not the session. The usage ledger stays, so the month's
 * spending is still counted.
 */
export async function deleteSession(d1: D1Database, id: string): Promise<DeletionResponse> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError("BAD_REQUEST", "That is not a session id.");
  const found = await d1.prepare("SELECT 1 AS ok FROM sessions WHERE id = ?1").bind(id).first();
  if (!found) throw new ApiError("NOT_FOUND", "No such session.");
  const [turns, listening, attempts] = await d1.batch<{ n: number }>([
    d1.prepare("SELECT COUNT(*) AS n FROM conversation_turns WHERE session_id = ?1").bind(id),
    d1.prepare("SELECT COUNT(*) AS n FROM listening_exercises WHERE session_id = ?1").bind(id),
    d1.prepare("SELECT COUNT(*) AS n FROM practice_attempts WHERE session_id = ?1").bind(id),
  ]);
  await d1.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
  return {
    deleted: {
      sessions: 1,
      conversation_turns: turns?.results[0]?.n ?? 0,
      listening_exercises: listening?.results[0]?.n ?? 0,
      practice_attempts: attempts?.results[0]?.n ?? 0,
    },
    kept: [
      "Review cards and ratings for the session's words: they belong to the words and still schedule your reviews.",
      "This month's usage ledger, so spending limits stay accurate.",
    ],
  };
}

/**
 * Deletes everything of the owner's except this UTC month's usage ledger,
 * which the spending limit needs. Settings go back to their defaults.
 * Reference data is untouched (SPEC §8.4).
 */
export async function deleteAllOwnerData(d1: D1Database, now: Date = new Date()): Promise<DeletionResponse> {
  const { start } = utcMonthBounds(now);
  const before = await counts(d1, OWNER_TABLES);
  const oldUsage = (await d1.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE recorded_at < ?1").bind(start).first<{ n: number }>())?.n ?? 0;
  await d1.batch([
    d1.prepare("DELETE FROM sessions"),
    d1.prepare("DELETE FROM review_cards"),
    d1.prepare("DELETE FROM practice_attempts"),
    d1.prepare("DELETE FROM mastery_states"),
    d1.prepare("DELETE FROM owner_settings"),
    d1.prepare("DELETE FROM usage_events WHERE recorded_at < ?1").bind(start),
  ]);
  const deleted = { ...before, usage_events: oldUsage };
  return {
    deleted,
    kept: [
      "This month's usage ledger (token and character counts, no text), so the spending limit cannot be reset by deleting data. It is removed by the next deletion after the month ends.",
      "Curriculum and colloquial reference data, which are not yours to delete here.",
    ],
  };
}

// --- Retention -----------------------------------------------------------------

/** The first study date whose conversation text is still kept. */
export function retentionCutoff(now: Date, days: number, timeZone: string): string {
  return localStudyDate(new Date(now.getTime() - days * 86_400_000), timeZone);
}

/**
 * Removes the conversation text of finished sessions older than the
 * retention period. Sessions keep their date, minutes and evidence. Safe to
 * run often; it does nothing when retention is off.
 */
export async function applyRetention(d1: D1Database, now: Date = new Date()): Promise<number> {
  const settings = await getSettings(d1);
  if (settings.transcriptRetentionDays === null) return 0;
  const cutoff = retentionCutoff(now, settings.transcriptRetentionDays, settings.timezone);
  const result = await d1
    .prepare(
      `DELETE FROM conversation_turns WHERE session_id IN (
  SELECT id FROM sessions WHERE local_study_date < ?1 AND status IN ('complete','abandoned'))`,
    )
    .bind(cutoff)
    .run();
  // Written and spoken answers to guided practice and writing are learner text too.
  await d1
    .prepare(
      `UPDATE session_materials SET practice_json = NULL, writing_json = NULL WHERE session_id IN (
  SELECT id FROM sessions WHERE local_study_date < ?1 AND status IN ('complete','abandoned'))
  AND (practice_json IS NOT NULL OR writing_json IS NOT NULL)`,
    )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

export async function dataSummary(d1: D1Database, now: Date = new Date()): Promise<DataSummaryResponse> {
  const settings = await getSettings(d1);
  const days = settings.transcriptRetentionDays;
  let past = 0;
  if (days !== null) {
    const cutoff = retentionCutoff(now, days, settings.timezone);
    past =
      (await d1
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE local_study_date < ?1 AND status IN ('complete','abandoned')")
        .bind(cutoff)
        .first<{ n: number }>())?.n ?? 0;
  }
  return { counts: await counts(d1, OWNER_TABLES), transcriptRetentionDays: days, sessionsPastRetention: past };
}
