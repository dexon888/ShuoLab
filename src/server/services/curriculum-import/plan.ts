import type { D1Database } from "@cloudflare/workers-types";
import { makeCurriculumItemId, type EditionDefinition } from "../../../shared/curriculum";
import {
  VOCAB_FIELD_MAPPING_VERSION,
  type SourceFile,
  type SqlStatement,
  type VocabRow,
} from "./types";

/** Rows per INSERT. Each chunk travels as one JSON parameter, well under D1's size limits. */
const ROWS_PER_STATEMENT = 200;

export interface SourceInfo {
  sourceUrl: string;
  /** Pinned commit of the source repository, when the owner supplied one. */
  commitSha: string | null;
  rightsNote: string;
}

export interface ImportPlanInput {
  edition: EditionDefinition;
  rows: readonly VocabRow[];
  files: readonly SourceFile[];
  source: SourceInfo;
  importedAt: string;
}

/**
 * Builds the statements for one vocabulary import. Applied together in a
 * single transaction, they are idempotent:
 *
 * - items are upserted on their immutable id, so re-running the same import
 *   changes nothing and never duplicates a row;
 * - nothing is deleted, so learner evidence that references an item survives;
 * - definition columns are left untouched, so a gloss imported separately
 *   (with its own provenance) is not overwritten by a syllabus re-import.
 */
export function buildImportStatements(input: ImportPlanInput): SqlStatement[] {
  const { edition, rows, files, source, importedAt } = input;
  const statements: SqlStatement[] = [];

  statements.push({
    sql: `INSERT INTO curriculum_editions (id, publisher, edition_date, is_active, notes)
VALUES (?1, ?2, ?3, 1, ?4)
ON CONFLICT(id) DO UPDATE SET
  publisher = excluded.publisher,
  edition_date = excluded.edition_date,
  is_active = 1,
  notes = excluded.notes`,
    params: [
      edition.id,
      edition.publisher,
      edition.editionDate,
      edition.synthetic ? "Generated placeholder data for development and tests. Not HSK content." : null,
    ],
  });
  statements.push({
    sql: "UPDATE curriculum_editions SET is_active = 0 WHERE id <> ?1",
    params: [edition.id],
  });

  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT).map((row) => ({
      id: makeCurriculumItemId({ editionId: edition.id, itemType: "vocab", sourceId: row.sourceId }),
      source_id: row.sourceId,
      hsk_band: row.hskBand,
      hanzi: row.hanzi,
      entry_raw: row.entryRaw,
      pinyin: row.pinyin,
      part_of_speech: row.partOfSpeech,
      homograph: row.homograph,
      level_label: row.levelLabel,
      source_pdf_page: row.sourcePdfPage,
    }));
    statements.push({
      sql: `INSERT INTO curriculum_items
  (id, edition_id, source_id, item_type, hsk_band, hanzi, entry_raw, pinyin,
   part_of_speech, homograph, level_label, source_pdf_page)
SELECT
  json_extract(value, '$.id'), ?1, json_extract(value, '$.source_id'), 'vocab',
  json_extract(value, '$.hsk_band'), json_extract(value, '$.hanzi'),
  json_extract(value, '$.entry_raw'), json_extract(value, '$.pinyin'),
  json_extract(value, '$.part_of_speech'), json_extract(value, '$.homograph'),
  json_extract(value, '$.level_label'), json_extract(value, '$.source_pdf_page')
FROM json_each(?2)
WHERE true
ON CONFLICT(id) DO UPDATE SET
  hsk_band = excluded.hsk_band,
  hanzi = excluded.hanzi,
  entry_raw = excluded.entry_raw,
  pinyin = excluded.pinyin,
  part_of_speech = excluded.part_of_speech,
  homograph = excluded.homograph,
  level_label = excluded.level_label,
  source_pdf_page = excluded.source_pdf_page`,
      params: [edition.id, JSON.stringify(chunk)],
    });
  }

  const rowsPerFile = new Map<string, number>();
  for (const row of rows) rowsPerFile.set(row.file, (rowsPerFile.get(row.file) ?? 0) + 1);

  for (const file of files) {
    statements.push({
      sql: `INSERT INTO source_manifests
  (id, edition_id, dataset_kind, source_url, commit_sha, sha256, rights_note,
   field_mapping_version, verification_status, record_count, imported_at)
VALUES (?1, ?2, 'vocab', ?3, ?4, ?5, ?6, ?7, 'verified', ?8, ?9)
ON CONFLICT(id) DO UPDATE SET
  source_url = excluded.source_url,
  commit_sha = excluded.commit_sha,
  rights_note = excluded.rights_note,
  field_mapping_version = excluded.field_mapping_version,
  verification_status = excluded.verification_status,
  record_count = excluded.record_count,
  imported_at = excluded.imported_at`,
      params: [
        // Same file content → same manifest row; a changed file adds a new row (history).
        `${edition.id}:vocab:${file.sha256}`,
        edition.id,
        `${source.sourceUrl}#${file.name}`,
        source.commitSha,
        file.sha256,
        source.rightsNote,
        VOCAB_FIELD_MAPPING_VERSION,
        rowsPerFile.get(file.name) ?? 0,
        importedAt,
      ],
    });
  }

  return statements;
}

/** Runs every statement in one D1 batch, which is a single transaction: all or nothing. */
export async function applyStatements(db: D1Database, statements: readonly SqlStatement[]) {
  await db.batch(statements.map((s) => db.prepare(s.sql).bind(...s.params)));
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Renders statements as a SQL script with literal values, for
 * `wrangler d1 execute --remote --file`. Each statement is put on one line
 * first, then its parameters are substituted in a single pass, so text inside
 * a value is never re-scanned or reformatted.
 */
export function renderSqlScript(statements: readonly SqlStatement[]): string {
  return (
    statements
      .map((statement) => {
        const oneLine = statement.sql.replace(/\s*\n\s*/g, " ");
        const sql = oneLine.replace(/\?(\d+)/g, (_match, index: string) =>
          sqlLiteral(statement.params[Number(index) - 1] ?? null),
        );
        return `${sql};`;
      })
      .join("\n") + "\n"
  );
}
