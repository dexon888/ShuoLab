import { HSK_BANDS, isHskBand, type EditionDefinition, type HskBand } from "../../../shared/curriculum";
import type { ImportIssue, RawRecord, VocabRow, VocabSourceField } from "./types";

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/** Text of a field, or null when it is absent, null or blank. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  return value.trim().length === 0 ? null : value;
}

function positiveInteger(value: unknown): number | null {
  const raw = text(value)?.trim();
  if (!raw || !POSITIVE_INTEGER.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Collapses sorted integers into "a–b" ranges for readable reports. */
export function formatRanges(sorted: readonly number[], limit = 12): string {
  const ranges: string[] = [];
  let start: number | undefined;
  let prev: number | undefined;
  const flush = () => {
    if (start === undefined || prev === undefined) return;
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
  };
  for (const n of sorted) {
    if (prev !== undefined && n === prev + 1) {
      prev = n;
      continue;
    }
    flush();
    start = n;
    prev = n;
  }
  flush();
  return ranges.length > limit
    ? `${ranges.slice(0, limit).join(", ")} and ${ranges.length - limit} more ranges`
    : ranges.join(", ");
}

/**
 * Validates raw records against one edition's published totals (SPEC §2.2 #3).
 * Returns every problem found; the caller must not write anything unless the
 * issue list is empty.
 */
export function validateVocab(
  records: readonly RawRecord[],
  edition: EditionDefinition,
): { rows: VocabRow[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const rows: VocabRow[] = [];
  const firstSeen = new Map<number, RawRecord>();
  const unknownLevels = new Map<string, number>();
  const total = edition.vocabTotalEntries;

  for (const record of records) {
    const at = { file: record.file, position: record.position };
    const before = issues.length;
    const field = (name: VocabSourceField) => record.fields[name];

    for (const [name, value] of Object.entries(record.fields)) {
      if (typeof value === "string" && value.includes("�")) {
        issues.push({
          ...at,
          code: "CORRUPT_TEXT",
          message: `Field "${name}" contains a replacement character (�), which means the text was damaged before import.`,
        });
      }
    }

    const sourceId = positiveInteger(field("id"));
    if (sourceId === null) {
      issues.push({
        ...at,
        code: "INVALID_ID",
        message: `"id" must be a whole number from 1 to ${total}; found ${JSON.stringify(field("id") ?? null)}.`,
      });
    } else if (sourceId > total) {
      issues.push({
        ...at,
        sourceId,
        code: "ID_OUT_OF_RANGE",
        message: `id ${sourceId} is outside 1–${total} for edition ${edition.id}.`,
      });
    } else {
      const earlier = firstSeen.get(sourceId);
      if (earlier) {
        issues.push({
          ...at,
          sourceId,
          code: "DUPLICATE_ID",
          message: `id ${sourceId} appears more than once (first in ${earlier.file} at ${earlier.position}). Each numbered entry must be imported exactly once: use either the single complete file or the per-level "new entries" files, never the cumulative lists, and only one format (CSV or JSON).`,
        });
      } else {
        firstSeen.set(sourceId, record);
      }
    }

    const levelRaw = text(field("level"))?.trim() ?? null;
    let hskBand: HskBand | null = null;
    if (levelRaw === null) {
      issues.push({ ...at, code: "MISSING_FIELD", message: `"level" is empty.` });
    } else if (isHskBand(levelRaw)) {
      hskBand = levelRaw;
    } else {
      unknownLevels.set(levelRaw, (unknownLevels.get(levelRaw) ?? 0) + 1);
      issues.push({
        ...at,
        code: "UNKNOWN_LEVEL",
        message: `Unknown level ${JSON.stringify(levelRaw)}. Valid levels are ${HSK_BANDS.join(", ")}; HSK 7–9 is one shared band written "7-9".`,
      });
    }

    const required = {
      hanzi: text(field("hanzi")),
      pinyin: text(field("pinyin")),
      entry: text(field("entry")),
      level_label: text(field("level_label")),
    };
    for (const [name, value] of Object.entries(required)) {
      if (value === null) {
        issues.push({ ...at, code: "MISSING_FIELD", message: `"${name}" is empty.` });
      }
    }

    const homographRaw = text(field("homograph"));
    const homograph = homographRaw === null ? null : positiveInteger(homographRaw);
    if (homographRaw !== null && homograph === null) {
      issues.push({
        ...at,
        code: "INVALID_HOMOGRAPH",
        message: `"homograph" must be empty or a whole number; found ${JSON.stringify(homographRaw)}.`,
      });
    }

    const page = positiveInteger(field("source_pdf_page"));
    if (page === null) {
      issues.push({
        ...at,
        code: text(field("source_pdf_page")) === null ? "MISSING_FIELD" : "INVALID_PAGE",
        message: `"source_pdf_page" must be a whole number; found ${JSON.stringify(field("source_pdf_page") ?? null)}.`,
      });
    }

    if (
      issues.length === before &&
      sourceId !== null &&
      hskBand !== null &&
      page !== null &&
      required.hanzi !== null &&
      required.pinyin !== null &&
      required.entry !== null &&
      required.level_label !== null
    ) {
      rows.push({
        sourceId,
        hskBand,
        hanzi: required.hanzi,
        pinyin: required.pinyin,
        partOfSpeech: text(field("part_of_speech")),
        entryRaw: required.entry,
        homograph: homograph === null ? null : String(homograph),
        levelLabel: required.level_label,
        sourcePdfPage: page,
        file: record.file,
      });
    }
  }

  // --- Whole-dataset checks -------------------------------------------------

  const missing: number[] = [];
  for (let id = 1; id <= total; id++) {
    if (!firstSeen.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    issues.push({
      code: "MISSING_IDS",
      message: `${missing.length} of ${total} numbered entries are missing: ${formatRanges(missing)}.`,
    });
  }

  const byBand = new Map<HskBand, number>();
  for (const row of rows) byBand.set(row.hskBand, (byBand.get(row.hskBand) ?? 0) + 1);
  for (const band of HSK_BANDS) {
    const expected = edition.vocabNewEntriesByBand[band];
    const actual = byBand.get(band) ?? 0;
    if (actual !== expected) {
      issues.push({
        code: "BAND_COUNT_MISMATCH",
        message: `HSK ${band}: found ${actual} valid new entries, but edition ${edition.id} has exactly ${expected}.`,
      });
    }
  }

  if (records.length !== total) {
    issues.push({
      code: "TOTAL_MISMATCH",
      message: `Found ${records.length} records in total, but edition ${edition.id} has exactly ${total} numbered entries.`,
    });
  }

  rows.sort((a, b) => a.sourceId - b.sourceId);
  return { rows, issues };
}
