/**
 * Grammar, character, topic and task import (SPEC §2.2 #1, #8).
 *
 * The source is a second-hand transcription (SPEC §2.2, "additional
 * structured data candidate"). There are no published totals for these
 * sections that ShuoLab can check against, so everything imported here is
 * stored as `unverified` and never counts toward verified HSK coverage.
 *
 * To make sure the files belong to the active edition, the source's own
 * vocabulary list must match the stored, verified vocabulary entry for entry;
 * otherwise nothing is imported.
 *
 * sections-v1 — one file per section, header row required:
 *   hsk_grammar.csv  examLevelId, content, grammarType, categoryType, grammarDetail, cases
 *   hsk_hanzi.csv    examLevelId, word, type            (type 1 = recognise, 2 = write)
 *   hsk_topic.csv    examLevelId, children, level1Content, level2Content, level3Content
 *   hsk_task.csv     examLevelId, children, level1Content, level2Content
 *   hsk_vocabulary.csv  type, word, pinyin, cixing, sort, levelName   (cross-check only)
 *
 * The source has no row ids, so `source_id` is the row's 1-based position
 * among the data rows of its file. Ids are therefore stable only for the
 * pinned commit and file checksum, which are both stored.
 */
import {
  HSK_BANDS,
  makeCurriculumItemId,
  type HskBand,
} from "../../../shared/curriculum";
import { CsvFormatError, parseCsv } from "./csv";
import type { SourceInfo } from "./plan";
import type { SourceFile, SqlStatement } from "./types";

export const SECTIONS_FIELD_MAPPING_VERSION = "sections-v1";

export const SECTION_FILES = {
  grammar: { file: "hsk_grammar.csv", columns: ["examLevelId", "content", "grammarType", "categoryType", "grammarDetail", "cases"] },
  character: { file: "hsk_hanzi.csv", columns: ["examLevelId", "word", "type"] },
  topic: { file: "hsk_topic.csv", columns: ["examLevelId", "children", "level1Content", "level2Content", "level3Content"] },
  task: { file: "hsk_task.csv", columns: ["examLevelId", "children", "level1Content", "level2Content"] },
} as const;
export type SectionType = keyof typeof SECTION_FILES;
export const SECTION_TYPES = Object.keys(SECTION_FILES) as SectionType[];

export const VOCAB_CROSSCHECK_FILE = { file: "hsk_vocabulary.csv", columns: ["word", "pinyin", "sort"] } as const;

export type SectionIssueCode =
  | "MISSING_FILE"
  | "INVALID_UTF8"
  | "BAD_FORMAT"
  | "MISSING_COLUMN"
  | "MISSING_FIELD"
  | "UNKNOWN_LEVEL"
  | "UNEXPECTED_VALUE"
  | "DUPLICATE_ROW"
  | "EMPTY_BAND"
  | "NO_VERIFIED_VOCAB"
  | "VOCAB_MISMATCH";

export interface SectionIssue {
  code: SectionIssueCode;
  message: string;
  file?: string;
  line?: number;
}

export interface SectionRow {
  itemType: SectionType;
  sourceId: number;
  hskBand: HskBand;
  /** The row's headline text, stored in `hanzi` so search and display work. */
  text: string;
  levelLabel: string;
  metadata: Record<string, unknown>;
  file: string;
}

/** One stored vocabulary entry of the active edition, for the cross-check. */
export interface StoredVocab {
  sourceId: number;
  hanzi: string;
  pinyin: string | null;
}

const LEVELS: Readonly<Record<string, HskBand>> = {
  HSK1: "1",
  HSK2: "2",
  HSK3: "3",
  HSK4: "4",
  HSK5: "5",
  HSK6: "6",
  "HSK7-9": "7-9",
};

const HAN = /\p{Script=Han}/u;

function decode(file: SourceFile, issues: SectionIssue[]): string | null {
  try {
    // fatal: malformed bytes throw. ignoreBOM false: a leading BOM is dropped.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(file.bytes);
  } catch {
    issues.push({ code: "INVALID_UTF8", message: "The file is not valid UTF-8.", file: file.name });
    return null;
  }
}

/** Parses a file into objects keyed by header, checking the required columns. */
function table(
  file: SourceFile,
  columns: readonly string[],
  issues: SectionIssue[],
): { line: number; get: (column: string) => string }[] | null {
  const text = decode(file, issues);
  if (text === null) return null;
  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    const line = error instanceof CsvFormatError ? error.line : undefined;
    issues.push({ code: "BAD_FORMAT", message: error instanceof Error ? error.message : "Malformed CSV.", file: file.name, line });
    return null;
  }
  const [header, ...data] = rows;
  if (!header) {
    issues.push({ code: "BAD_FORMAT", message: "The file is empty.", file: file.name });
    return null;
  }
  const index = new Map(header.cells.map((name, i) => [name.trim(), i]));
  const missing = columns.filter((c) => !index.has(c));
  if (missing.length) {
    issues.push({ code: "MISSING_COLUMN", message: `Missing column(s): ${missing.join(", ")}.`, file: file.name });
    return null;
  }
  return data.map((row) => ({
    line: row.line,
    get: (column: string) => (row.cells[index.get(column) ?? -1] ?? "").trim(),
  }));
}

/** Examples are separated by a literal backslash-n in the source. */
function splitExamples(cases: string): string[] {
  return cases
    .split(/\\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readSection(type: SectionType, file: SourceFile, issues: SectionIssue[]): SectionRow[] {
  const spec = SECTION_FILES[type];
  const rows = table(file, spec.columns, issues);
  if (!rows) return [];
  const out: SectionRow[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const at = { file: file.name, line: row.line };
    const levelLabel = row.get("examLevelId");
    const band = LEVELS[levelLabel];
    if (!band) {
      issues.push({ code: "UNKNOWN_LEVEL", message: `Unknown level "${levelLabel}".`, ...at });
      return;
    }
    const need = (column: string) => {
      const value = row.get(column);
      if (!value) issues.push({ code: "MISSING_FIELD", message: `"${column}" is empty.`, ...at });
      return value;
    };
    let text: string;
    let metadata: Record<string, unknown>;

    if (type === "grammar") {
      const content = row.get("content");
      const detail = row.get("grammarDetail");
      // A few rows name the point only in grammarDetail (e.g. 陈述句).
      text = content || detail;
      if (!text) issues.push({ code: "MISSING_FIELD", message: '"content" and "grammarDetail" are both empty.', ...at });
      const examples = splitExamples(need("cases"));
      metadata = {
        grammarType: need("grammarType"),
        category: row.get("categoryType") || null,
        detail: detail || null,
        examples,
      };
    } else if (type === "character") {
      text = need("word");
      if (text && ([...text].length !== 1 || !HAN.test(text))) {
        issues.push({ code: "UNEXPECTED_VALUE", message: `"${text}" is not a single Chinese character.`, ...at });
      }
      const kind = row.get("type");
      if (kind !== "1" && kind !== "2") {
        issues.push({ code: "UNEXPECTED_VALUE", message: `type "${kind}" is neither 1 (recognise) nor 2 (write).`, ...at });
      }
      metadata = { skill: kind === "2" ? "writing" : "recognition" };
    } else {
      // Topics and tasks: nested children are not part of sections-v1.
      if (row.get("children") !== "[]") {
        issues.push({ code: "UNEXPECTED_VALUE", message: `"children" is "${row.get("children")}"; only [] is supported.`, ...at });
      }
      if (type === "topic") {
        const [l1, l2, l3] = [need("level1Content"), need("level2Content"), need("level3Content")];
        text = l3;
        metadata = { area: l1, subject: l2, details: l3 };
      } else {
        const [l1, l2] = [need("level1Content"), need("level2Content")];
        text = l1;
        metadata = { task: l1, canDo: l2 };
      }
    }

    const key = `${band}|${text}|${JSON.stringify(metadata)}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push({ code: "DUPLICATE_ROW", message: `Repeats line ${earlier}.`, ...at });
    }
    seen.set(key, row.line);
    out.push({ itemType: type, sourceId: i + 1, hskBand: band, text, levelLabel, metadata, file: file.name });
  });

  for (const band of HSK_BANDS) {
    if (!out.some((r) => r.hskBand === band)) {
      issues.push({ code: "EMPTY_BAND", message: `No rows for HSK ${band}.`, file: file.name });
    }
  }
  return out;
}

/** Strips homograph markers so 本1 and 本¹ compare equal to 本. */
function bare(word: string): string {
  return word.replace(/[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
}

function crossCheckVocab(file: SourceFile, stored: readonly StoredVocab[], issues: SectionIssue[]) {
  if (stored.length === 0) {
    issues.push({
      code: "NO_VERIFIED_VOCAB",
      message: "Import and verify the vocabulary first (pnpm curriculum:import); the sections are checked against it.",
    });
    return;
  }
  const rows = table(file, VOCAB_CROSSCHECK_FILE.columns, issues);
  if (!rows) return;
  const ours = new Map(stored.map((v) => [v.sourceId, v]));
  const problems: string[] = [];
  const matched = new Set<number>();
  for (const row of rows) {
    const id = Number(row.get("sort"));
    const mine = ours.get(id);
    if (!mine) {
      problems.push(`line ${row.line}: entry ${row.get("sort")} is not in the stored vocabulary`);
      continue;
    }
    matched.add(id);
    if (bare(mine.hanzi) !== bare(row.get("word")) || (mine.pinyin ?? "") !== row.get("pinyin")) {
      problems.push(`entry ${id}: stored ${mine.hanzi} ${mine.pinyin ?? ""}, source ${row.get("word")} ${row.get("pinyin")}`);
    }
  }
  const unmatched = stored.length - matched.size;
  if (unmatched > 0) problems.push(`${unmatched} stored entries are missing from the source`);
  if (problems.length) {
    issues.push({
      code: "VOCAB_MISMATCH",
      message: `The source's vocabulary does not match the active edition, so it may be a different syllabus (${problems.length} difference(s); first: ${problems.slice(0, 3).join("; ")}).`,
      file: file.name,
    });
  }
}

export interface PrepareSectionsInput {
  editionId: string;
  files: readonly SourceFile[];
  storedVocab: readonly StoredVocab[];
  source: SourceInfo;
  importedAt: string;
}

export interface SectionsSummary {
  editionId: string;
  vocabularyMatched: number;
  counts: Record<SectionType, Record<HskBand, number>>;
  files: { name: string; sha256: string }[];
}

export type PrepareSectionsResult =
  | { ok: true; statements: SqlStatement[]; summary: SectionsSummary }
  | { ok: false; issues: SectionIssue[] };

/** Reads and checks all four sections and, only if all are clean, returns the statements. */
export function prepareSectionsImport(input: PrepareSectionsInput): PrepareSectionsResult {
  const issues: SectionIssue[] = [];
  const byName = new Map(input.files.map((f) => [f.name, f]));

  const vocabFile = byName.get(VOCAB_CROSSCHECK_FILE.file);
  if (!vocabFile) {
    issues.push({ code: "MISSING_FILE", message: `${VOCAB_CROSSCHECK_FILE.file} is needed to check the edition.` });
  } else {
    crossCheckVocab(vocabFile, input.storedVocab, issues);
  }

  const rows: SectionRow[] = [];
  for (const type of SECTION_TYPES) {
    const file = byName.get(SECTION_FILES[type].file);
    if (!file) {
      issues.push({ code: "MISSING_FILE", message: `${SECTION_FILES[type].file} was not found.` });
      continue;
    }
    rows.push(...readSection(type, file, issues));
  }
  if (issues.length) return { ok: false, issues };

  const counts = Object.fromEntries(
    SECTION_TYPES.map((t) => [t, Object.fromEntries(HSK_BANDS.map((b) => [b, 0]))]),
  ) as SectionsSummary["counts"];
  for (const r of rows) counts[r.itemType][r.hskBand]++;

  const used = input.files.filter((f) => f.name === VOCAB_CROSSCHECK_FILE.file || SECTION_TYPES.some((t) => SECTION_FILES[t].file === f.name));
  return {
    ok: true,
    statements: buildSectionStatements(input.editionId, rows, used, input.source, input.importedAt, input.storedVocab.length),
    summary: {
      editionId: input.editionId,
      vocabularyMatched: input.storedVocab.length,
      counts,
      files: used.map((f) => ({ name: f.name, sha256: f.sha256 })),
    },
  };
}

const ROWS_PER_STATEMENT = 200;

/**
 * Upserts the rows on their immutable ids and records one `unverified`
 * manifest per file. Nothing is deleted and the edition row is not touched.
 */
export function buildSectionStatements(
  editionId: string,
  rows: readonly SectionRow[],
  files: readonly SourceFile[],
  source: SourceInfo,
  importedAt: string,
  /** Entries the vocabulary file was matched against, recorded as its row count. */
  vocabMatched = 0,
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT).map((r) => ({
      id: makeCurriculumItemId({ editionId, itemType: r.itemType, sourceId: r.sourceId }),
      source_id: r.sourceId,
      item_type: r.itemType,
      hsk_band: r.hskBand,
      hanzi: r.text,
      level_label: r.levelLabel,
      metadata_json: JSON.stringify(r.metadata),
    }));
    statements.push({
      sql: `INSERT INTO curriculum_items
  (id, edition_id, source_id, item_type, hsk_band, hanzi, level_label, metadata_json)
SELECT
  json_extract(value, '$.id'), ?1, json_extract(value, '$.source_id'), json_extract(value, '$.item_type'),
  json_extract(value, '$.hsk_band'), json_extract(value, '$.hanzi'),
  json_extract(value, '$.level_label'), json_extract(value, '$.metadata_json')
FROM json_each(?2)
WHERE true
ON CONFLICT(id) DO UPDATE SET
  hsk_band = excluded.hsk_band,
  hanzi = excluded.hanzi,
  level_label = excluded.level_label,
  metadata_json = excluded.metadata_json`,
      params: [editionId, JSON.stringify(chunk)],
    });
  }

  const perFile = new Map<string, number>();
  for (const r of rows) perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1);
  perFile.set(VOCAB_CROSSCHECK_FILE.file, vocabMatched);
  for (const file of files) {
    const kind = file.name === VOCAB_CROSSCHECK_FILE.file
      ? "vocab-crosscheck"
      : (SECTION_TYPES.find((t) => SECTION_FILES[t].file === file.name) ?? "unknown");
    statements.push({
      sql: `INSERT INTO source_manifests
  (id, edition_id, dataset_kind, source_url, commit_sha, sha256, rights_note,
   field_mapping_version, verification_status, record_count, imported_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'unverified', ?9, ?10)
ON CONFLICT(id) DO UPDATE SET
  source_url = excluded.source_url,
  commit_sha = excluded.commit_sha,
  rights_note = excluded.rights_note,
  field_mapping_version = excluded.field_mapping_version,
  record_count = excluded.record_count,
  imported_at = excluded.imported_at`,
      params: [
        `${editionId}:${kind}:${file.sha256}`,
        editionId,
        kind,
        `${source.sourceUrl}#${file.name}`,
        source.commitSha,
        file.sha256,
        source.rightsNote,
        SECTIONS_FIELD_MAPPING_VERSION,
        perFile.get(file.name) ?? 0,
        importedAt,
      ],
    });
  }
  return statements;
}
