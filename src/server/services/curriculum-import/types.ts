import type { HskBand } from "../../../shared/curriculum";

/**
 * Version of the vocabulary field mapping below. Stored with every source
 * manifest so a later change to the mapping is traceable (SPEC §2.2 #2).
 *
 * vocab-v1 — source column → curriculum_items column
 *   id              → source_id        integer 1..N, unique per edition (required)
 *   level           → hsk_band         "1".."6" or "7-9" (required)
 *   hanzi           → hanzi            (required)
 *   pinyin          → pinyin           (required)
 *   part_of_speech  → part_of_speech   (may be empty)
 *   entry           → entry_raw        raw syllabus form, e.g. 本1 (required)
 *   homograph       → homograph        positive integer or empty
 *   level_label     → level_label      source label, e.g. 1（4） (required)
 *   source_pdf_page → source_pdf_page  positive integer (required)
 *
 * No English definition is read: the syllabus has none (SPEC §2.2 #5).
 */
export const VOCAB_FIELD_MAPPING_VERSION = "vocab-v1";

export const VOCAB_SOURCE_FIELDS = [
  "id",
  "level",
  "hanzi",
  "pinyin",
  "part_of_speech",
  "entry",
  "homograph",
  "level_label",
  "source_pdf_page",
] as const;
export type VocabSourceField = (typeof VOCAB_SOURCE_FIELDS)[number];

/** Bytes of one user-provided file, as read from disk. */
export interface SourceFile {
  name: string;
  bytes: Uint8Array;
  sha256: string;
}

/** One record as it appears in a source file, before validation. */
export interface RawRecord {
  file: string;
  /** 1-based line (CSV) or 1-based array position (JSON). */
  position: number;
  fields: Partial<Record<VocabSourceField, unknown>>;
}

/** A fully validated vocabulary entry, ready to store. */
export interface VocabRow {
  sourceId: number;
  hskBand: HskBand;
  hanzi: string;
  pinyin: string;
  partOfSpeech: string | null;
  entryRaw: string;
  homograph: string | null;
  levelLabel: string;
  sourcePdfPage: number;
  file: string;
}

export const ISSUE_CODES = [
  "NO_FILES",
  "INVALID_UTF8",
  "BAD_FORMAT",
  "MISSING_COLUMN",
  "MISSING_FIELD",
  "INVALID_ID",
  "ID_OUT_OF_RANGE",
  "DUPLICATE_ID",
  "UNKNOWN_LEVEL",
  "INVALID_HOMOGRAPH",
  "INVALID_PAGE",
  "CORRUPT_TEXT",
  "MISSING_IDS",
  "BAND_COUNT_MISMATCH",
  "TOTAL_MISMATCH",
  "UNKNOWN_EDITION",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface ImportIssue {
  code: IssueCode;
  message: string;
  file?: string;
  position?: number;
  sourceId?: number;
}

/** A parameterised SQL statement. Values are bound, never interpolated. */
export interface SqlStatement {
  sql: string;
  params: (string | number | null)[];
}
