/**
 * Validated import of a colloquial-expression dataset (SPEC §2.3).
 *
 * Pure code: bytes in, SQL statements out. The whole file is validated before
 * anything is written, and one problem rejects the import.
 *
 * colloquial-v1 — source field → colloquial_expressions column
 *   slug       → slug              stable identifier (required, unique)
 *   term       → term              (required)
 *   pinyin     → pinyin            (may be empty)
 *   real_en    → meaning_en        what it means in use (required)
 *   literal_en → literal_en        what the characters literally say (may be empty)
 *   category   → category          stored as given (may be empty)
 *   register   → register          anyone→neutral, casual→casual, mates→very_informal
 *   channel    → channel           spoken | typed | both
 *   since      → in_use_since      stored as given (may be empty)
 *   status     → currency_status   hot | steady | fading; empty → unknown
 *   checked    → last_verified_at  YYYY-MM or YYYY-MM-DD (may be empty)
 *   url        → source_url        https address of the source entry (required)
 *
 * A status with no `checked` date is stored as `unknown`: the source does not
 * stand behind an undated status. Example sentences and audio are not part of
 * the dataset and are never imported.
 */
import {
  COLLOQUIAL_CHANNELS,
  CURRENCY_STATUSES,
  isColloquialSlug,
  makeColloquialId,
  type ColloquialChannel,
  type ColloquialRegister,
  type ColloquialSource,
  type CurrencyStatus,
} from "../../shared/colloquial";
import { CsvFormatError, parseCsv, type SourceFile, type SqlStatement } from "./curriculum-import";

export const COLLOQUIAL_FIELD_MAPPING_VERSION = "colloquial-v1";

const REQUIRED_COLUMNS = ["slug", "term", "real_en", "register", "channel", "url"] as const;
const OPTIONAL_COLUMNS = ["pinyin", "literal_en", "category", "since", "status", "checked"] as const;
type SourceField = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

/** Register words used by the source, and the SPEC's own names, mapped to stored values. */
const REGISTER_MAP: Readonly<Record<string, ColloquialRegister>> = {
  anyone: "neutral",
  neutral: "neutral",
  formal: "formal",
  casual: "casual",
  mates: "very_informal",
  "very informal": "very_informal",
  very_informal: "very_informal",
};

export type ColloquialIssueCode =
  | "INVALID_UTF8"
  | "BAD_FORMAT"
  | "MISSING_COLUMN"
  | "MISSING_FIELD"
  | "INVALID_SLUG"
  | "DUPLICATE_SLUG"
  | "UNKNOWN_REGISTER"
  | "UNKNOWN_CHANNEL"
  | "UNKNOWN_STATUS"
  | "INVALID_DATE"
  | "INVALID_URL"
  | "CORRUPT_TEXT"
  | "TOO_LONG"
  | "COUNT_MISMATCH"
  | "NO_ROWS";

export interface ColloquialIssue {
  code: ColloquialIssueCode;
  message: string;
  /** 1-based line (CSV) or 1-based position in the list (JSON). */
  position?: number;
}

export interface ColloquialRow {
  slug: string;
  term: string;
  pinyin: string | null;
  meaningEn: string;
  literalEn: string | null;
  category: string | null;
  register: ColloquialRegister;
  channel: ColloquialChannel;
  inUseSince: string | null;
  currencyStatus: CurrencyStatus;
  lastVerifiedAt: string | null;
  sourceUrl: string;
}

export interface ColloquialSummary {
  sourceKey: string;
  synthetic: boolean;
  total: number;
  datasetVersion: string | null;
  byRegister: Record<string, number>;
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
  file: { name: string; sha256: string };
}

export type PrepareColloquialResult =
  | { ok: true; rows: ColloquialRow[]; summary: ColloquialSummary; statements: SqlStatement[] }
  | { ok: false; issues: ColloquialIssue[] };

interface RawRecord {
  position: number;
  fields: Partial<Record<SourceField, unknown>>;
}

const MAX_LENGTH: Readonly<Record<SourceField, number>> = {
  slug: 80,
  term: 80,
  pinyin: 200,
  real_en: 1000,
  literal_en: 1000,
  category: 40,
  register: 20,
  channel: 20,
  since: 20,
  status: 20,
  checked: 10,
  url: 300,
};

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
}

function readCsv(text: string, issues: ColloquialIssue[]): RawRecord[] {
  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvFormatError) {
      issues.push({ code: "BAD_FORMAT", message: `${error.message}.`, position: error.line });
      return [];
    }
    throw error;
  }
  const header = rows[0];
  if (!header) {
    issues.push({ code: "BAD_FORMAT", message: "The file is empty." });
    return [];
  }
  const columns = header.cells.map((c) => c.trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    issues.push({
      code: "MISSING_COLUMN",
      message: `The header row is missing: ${missing.join(", ")}.`,
      position: header.line,
    });
    return [];
  }
  const records: RawRecord[] = [];
  for (const row of rows.slice(1)) {
    if (row.cells.length !== columns.length) {
      issues.push({
        code: "BAD_FORMAT",
        message: `Expected ${columns.length} columns but found ${row.cells.length}.`,
        position: row.line,
      });
      continue;
    }
    const fields: RawRecord["fields"] = {};
    for (const name of [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]) {
      const index = columns.indexOf(name);
      if (index >= 0) fields[name] = row.cells[index];
    }
    records.push({ position: row.line, fields });
  }
  return records;
}

interface JsonRead {
  records: RawRecord[];
  version: string | null;
}

function readJson(text: string, issues: ColloquialIssue[]): JsonRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    issues.push({ code: "BAD_FORMAT", message: "The file is not valid JSON." });
    return { records: [], version: null };
  }
  let list: unknown;
  let version: string | null = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    list = object.terms;
    if (typeof object.version === "string" && object.version.trim()) version = object.version.trim().slice(0, 40);
    if (Array.isArray(list) && typeof object.count === "number" && object.count !== list.length) {
      issues.push({
        code: "COUNT_MISMATCH",
        message: `The file says it holds ${object.count} terms but lists ${list.length}. It may be truncated.`,
      });
    }
  }
  if (!Array.isArray(list)) {
    issues.push({ code: "BAD_FORMAT", message: 'Expected a list of terms, or an object with a "terms" list.' });
    return { records: [], version };
  }
  const records: RawRecord[] = [];
  list.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({ code: "BAD_FORMAT", message: "Each term must be an object.", position: index + 1 });
      return;
    }
    records.push({ position: index + 1, fields: entry as RawRecord["fields"] });
  });
  return { records, version };
}

/** Text of a field, or null when it is absent or blank. Non-text values are rejected by the caller. */
function textOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// U+FFFD or control characters mean the text was damaged on the way here.
// eslint-disable-next-line no-control-regex
const CORRUPT = /[�\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validate(records: RawRecord[], issues: ColloquialIssue[]): ColloquialRow[] {
  const rows: ColloquialRow[] = [];
  const seen = new Map<string, number>();

  for (const record of records) {
    const before = issues.length;
    const position = record.position;
    const values = {} as Record<SourceField, string | null>;

    for (const name of [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]) {
      const value = textOf(record.fields[name]);
      if (value === undefined) {
        issues.push({ code: "BAD_FORMAT", message: `Field "${name}" must be text.`, position });
        values[name] = null;
        continue;
      }
      if (value !== null && CORRUPT.test(value)) {
        issues.push({ code: "CORRUPT_TEXT", message: `Field "${name}" contains damaged characters.`, position });
      }
      if (value !== null && value.length > MAX_LENGTH[name]) {
        issues.push({ code: "TOO_LONG", message: `Field "${name}" is longer than ${MAX_LENGTH[name]} characters.`, position });
      }
      values[name] = value;
    }
    for (const name of REQUIRED_COLUMNS) {
      if (values[name] === null && issues.length === before) {
        issues.push({ code: "MISSING_FIELD", message: `Field "${name}" is empty.`, position });
      }
    }
    if (issues.length > before) continue;

    const slug = values.slug as string;
    if (!isColloquialSlug(slug)) {
      issues.push({ code: "INVALID_SLUG", message: `"${slug.slice(0, 40)}" is not a valid identifier (lower-case letters, digits, - and _).`, position });
    } else if (seen.has(slug)) {
      issues.push({ code: "DUPLICATE_SLUG", message: `Identifier "${slug}" also appears at ${seen.get(slug)}.`, position });
    } else {
      seen.set(slug, position);
    }

    const register = REGISTER_MAP[(values.register as string).toLowerCase()];
    if (!register) {
      issues.push({ code: "UNKNOWN_REGISTER", message: `Unknown register "${(values.register as string).slice(0, 40)}".`, position });
    }

    const channel = (values.channel as string).toLowerCase();
    if (!(COLLOQUIAL_CHANNELS as readonly string[]).includes(channel)) {
      issues.push({ code: "UNKNOWN_CHANNEL", message: `Unknown channel "${channel.slice(0, 40)}".`, position });
    }

    const status = values.status?.toLowerCase() ?? "unknown";
    if (!(CURRENCY_STATUSES as readonly string[]).includes(status)) {
      issues.push({ code: "UNKNOWN_STATUS", message: `Unknown status "${status.slice(0, 40)}".`, position });
    }

    const checked = values.checked;
    if (checked !== null && !/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.test(checked)) {
      issues.push({ code: "INVALID_DATE", message: `"${checked}" is not a date like 2026-09 or 2026-09-09.`, position });
    }

    const url = values.url as string;
    if (!isHttpsUrl(url)) {
      issues.push({ code: "INVALID_URL", message: "The entry address must be an https address.", position });
    }

    if (issues.length > before || !register) continue;

    rows.push({
      slug,
      term: values.term as string,
      pinyin: values.pinyin,
      meaningEn: values.real_en as string,
      literalEn: values.literal_en,
      category: values.category?.toLowerCase() ?? null,
      register,
      channel: channel as ColloquialChannel,
      inUseSince: values.since,
      // An undated status is not a claim the source stands behind.
      currencyStatus: checked === null ? "unknown" : (status as CurrencyStatus),
      lastVerifiedAt: checked,
      sourceUrl: url,
    });
  }
  return rows;
}

function tally<T extends string>(rows: readonly ColloquialRow[], pick: (row: ColloquialRow) => T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[pick(row)] = (counts[pick(row)] ?? 0) + 1;
  return counts;
}

export interface PrepareColloquialInput {
  source: ColloquialSource;
  file: SourceFile;
  importedAt: string;
  /** Version of the dataset, when the file itself does not carry one (CSV). */
  datasetVersion?: string | null;
}

export function prepareColloquialImport(input: PrepareColloquialInput): PrepareColloquialResult {
  const { source, file, importedAt } = input;
  const issues: ColloquialIssue[] = [];

  const text = decodeUtf8(file.bytes);
  if (text === null) {
    return { ok: false, issues: [{ code: "INVALID_UTF8", message: "The file is not valid UTF-8." }] };
  }

  let records: RawRecord[];
  let version = input.datasetVersion?.trim() || null;
  if (/\.json$/i.test(file.name)) {
    const read = readJson(text, issues);
    records = read.records;
    version = read.version ?? version;
  } else {
    records = readCsv(text, issues);
  }

  const rows = validate(records, issues);
  if (issues.length === 0 && rows.length === 0) {
    issues.push({ code: "NO_ROWS", message: "The file holds no expressions." });
  }
  if (issues.length > 0) return { ok: false, issues };

  const payload = rows.map((row) => ({
    id: makeColloquialId(source.key, row.slug),
    slug: row.slug,
    term: row.term,
    pinyin: row.pinyin,
    meaning_en: row.meaningEn,
    literal_en: row.literalEn,
    category: row.category,
    register: row.register,
    channel: row.channel,
    currency_status: row.currencyStatus,
    in_use_since: row.inUseSince,
    last_verified_at: row.lastVerifiedAt,
    source_url: row.sourceUrl,
  }));

  const statements: SqlStatement[] = [];
  const ROWS_PER_STATEMENT = 200;
  for (let i = 0; i < payload.length; i += ROWS_PER_STATEMENT) {
    statements.push({
      // Upsert on the stable id: re-importing changes nothing and never
      // duplicates. Nothing is deleted, so later practice records stay valid.
      sql: `INSERT INTO colloquial_expressions
  (id, source_key, slug, term, pinyin, meaning_en, literal_en, category, register, channel,
   currency_status, in_use_since, last_verified_at, source_url, license, attribution,
   verification_status, dataset_version, file_sha256, imported_at)
SELECT
  json_extract(value, '$.id'), ?1, json_extract(value, '$.slug'), json_extract(value, '$.term'),
  json_extract(value, '$.pinyin'), json_extract(value, '$.meaning_en'),
  json_extract(value, '$.literal_en'), json_extract(value, '$.category'),
  json_extract(value, '$.register'), json_extract(value, '$.channel'),
  json_extract(value, '$.currency_status'), json_extract(value, '$.in_use_since'),
  json_extract(value, '$.last_verified_at'), json_extract(value, '$.source_url'),
  ?2, ?3, 'verified', ?4, ?5, ?6
FROM json_each(?7)
WHERE true
ON CONFLICT(id) DO UPDATE SET
  term = excluded.term,
  pinyin = excluded.pinyin,
  meaning_en = excluded.meaning_en,
  literal_en = excluded.literal_en,
  category = excluded.category,
  register = excluded.register,
  channel = excluded.channel,
  currency_status = excluded.currency_status,
  in_use_since = excluded.in_use_since,
  last_verified_at = excluded.last_verified_at,
  source_url = excluded.source_url,
  license = excluded.license,
  attribution = excluded.attribution,
  verification_status = excluded.verification_status,
  dataset_version = excluded.dataset_version,
  file_sha256 = excluded.file_sha256,
  imported_at = excluded.imported_at`,
      params: [
        source.key,
        source.license,
        source.attribution,
        version,
        file.sha256,
        importedAt,
        JSON.stringify(payload.slice(i, i + ROWS_PER_STATEMENT)),
      ],
    });
  }

  return {
    ok: true,
    rows,
    statements,
    summary: {
      sourceKey: source.key,
      synthetic: source.synthetic,
      total: rows.length,
      datasetVersion: version,
      byRegister: tally(rows, (r) => r.register),
      byChannel: tally(rows, (r) => r.channel),
      byStatus: tally(rows, (r) => r.currencyStatus),
      file: { name: file.name, sha256: file.sha256 },
    },
  };
}
