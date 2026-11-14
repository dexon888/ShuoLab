/**
 * SYNTHETIC vocabulary fixture. Every row is a generated placeholder
 * ("样例词" + number); none of it is HSK syllabus content. It has the same
 * shape and the same per-band totals as the real edition so the importer,
 * integrity checks and UI can be exercised without the copyrighted source.
 */
import {
  HSK_BANDS,
  VOCAB_NEW_ENTRIES_BY_BAND,
  type HskBand,
} from "../../src/shared/curriculum";
import { VOCAB_SOURCE_FIELDS } from "../../src/server/services/curriculum-import/types";

export interface SyntheticRecord {
  id: number;
  level: string;
  hanzi: string;
  pinyin: string;
  part_of_speech: string | null;
  entry: string;
  homograph: number | null;
  level_label: string;
  source_pdf_page: number;
}

/** Ids that share one written form, to exercise homograph identity. */
export const SYNTHETIC_HOMOGRAPH_IDS = [10, 11] as const;

export function makeSyntheticRecords(): SyntheticRecord[] {
  const records: SyntheticRecord[] = [];
  let id = 0;
  for (const band of HSK_BANDS) {
    for (let i = 0; i < VOCAB_NEW_ENTRIES_BY_BAND[band]; i++) {
      id++;
      const homographIndex = (SYNTHETIC_HOMOGRAPH_IDS as readonly number[]).indexOf(id);
      const isHomograph = homographIndex >= 0;
      const hanzi = isHomograph ? "样例同形词" : `样例词${id}`;
      records.push({
        id,
        level: band,
        hanzi,
        pinyin: isHomograph ? "yànglì tóngxíngcí" : `yànglìcí ${id}`,
        // Every seventh row has no part of speech, as some real phrases do not.
        part_of_speech: id % 7 === 0 ? null : "名",
        entry: isHomograph ? `${hanzi}${homographIndex + 1}` : hanzi,
        homograph: isHomograph ? homographIndex + 1 : null,
        // Some real labels carry a later-use annotation in full-width brackets.
        level_label: id % 50 === 0 && band !== "7-9" ? `${band}（${Number(band) + 1}）` : band,
        source_pdf_page: 80 + Math.floor((id - 1) / 75),
      });
    }
  }
  return records;
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Serialises records the way the source dataset does: UTF-8 CSV with a BOM. */
export function toCsv(records: readonly SyntheticRecord[], options: { bom?: boolean } = {}): string {
  const lines = [VOCAB_SOURCE_FIELDS.join(",")];
  for (const record of records) {
    lines.push(VOCAB_SOURCE_FIELDS.map((field) => csvCell(record[field])).join(","));
  }
  return (options.bom === false ? "" : "﻿") + lines.join("\n") + "\n";
}

export function toJson(records: readonly SyntheticRecord[]): string {
  return JSON.stringify(records, null, 1);
}

export function recordsForBand(records: readonly SyntheticRecord[], band: HskBand): SyntheticRecord[] {
  return records.filter((r) => r.level === band);
}
