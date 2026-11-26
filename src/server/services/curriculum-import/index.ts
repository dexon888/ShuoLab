/**
 * Vocabulary import pipeline (SPEC §2.2). Pure and runtime-agnostic: file
 * access, hashing and database connections belong to the calling script.
 *
 *   files → readVocabFiles → validateVocab → buildImportStatements → apply
 *
 * Nothing is written unless validation returns no issues, and the write
 * itself is one transaction.
 */
import { HSK_BANDS, getEdition, type HskBand } from "../../../shared/curriculum";
import { buildImportStatements, type SourceInfo } from "./plan";
import { readVocabFiles } from "./read";
import type { ImportIssue, SourceFile, SqlStatement } from "./types";
import { validateVocab } from "./validate";

export * from "./types";
export { CsvFormatError, parseCsv } from "./csv";
export { applyStatements, buildImportStatements, renderSqlScript, type SourceInfo } from "./plan";
export { readVocabFiles } from "./read";
export { formatRanges, validateVocab } from "./validate";
export { verifyDatabase, type QueryFn, type VerifyCheck, type VerifyReport } from "./verify";

export interface PrepareImportInput {
  editionId: string;
  files: readonly SourceFile[];
  source: SourceInfo;
  importedAt: string;
}

export interface ImportSummary {
  editionId: string;
  synthetic: boolean;
  totalEntries: number;
  entriesByBand: Record<HskBand, number>;
  homographEntries: number;
  files: { name: string; sha256: string }[];
}

export type PrepareImportResult =
  | { ok: true; statements: SqlStatement[]; summary: ImportSummary }
  | { ok: false; issues: ImportIssue[] };

/** Reads and validates the files and, only if they are clean, returns the statements to apply. */
export function prepareVocabImport(input: PrepareImportInput): PrepareImportResult {
  const edition = getEdition(input.editionId);
  if (!edition) {
    return {
      ok: false,
      issues: [
        {
          code: "UNKNOWN_EDITION",
          message: `Unknown edition "${input.editionId}". There are no published totals to verify it against.`,
        },
      ],
    };
  }
  if (input.files.length === 0) {
    return {
      ok: false,
      issues: [{ code: "NO_FILES", message: "No .csv or .json files were found in the source directory." }],
    };
  }

  const read = readVocabFiles(input.files);
  const validated = validateVocab(read.records, edition);
  const issues = [...read.issues, ...validated.issues];
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const entriesByBand = Object.fromEntries(HSK_BANDS.map((b) => [b, 0])) as Record<HskBand, number>;
  for (const row of validated.rows) entriesByBand[row.hskBand]++;

  return {
    ok: true,
    statements: buildImportStatements({
      edition,
      rows: validated.rows,
      files: input.files,
      source: input.source,
      importedAt: input.importedAt,
    }),
    summary: {
      editionId: edition.id,
      synthetic: edition.synthetic,
      totalEntries: validated.rows.length,
      entriesByBand,
      homographEntries: validated.rows.filter((r) => r.homograph !== null).length,
      files: input.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
    },
  };
}
export {
  prepareSectionsImport,
  SECTION_FILES,
  SECTION_TYPES,
  SECTIONS_FIELD_MAPPING_VERSION,
  VOCAB_CROSSCHECK_FILE,
  type SectionIssue,
  type SectionType,
  type SectionsSummary,
  type StoredVocab,
} from "./sections";
