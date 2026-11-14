/**
 * HSK 3.0 curriculum constants shared by client, server and import tooling.
 *
 * Counts are the published first-introduction totals of the November 2025
 * syllabus (SPEC §2.1). They are numbered syllabus entries, not unique written
 * forms, and they are used only to validate imported data — never to invent it.
 */

export const ACTIVE_EDITION_ID = "hsk3-2025-11";

/** HSK 7–9 is one shared advanced band; there are no separate 7, 8 or 9 lists. */
export const HSK_BANDS = ["1", "2", "3", "4", "5", "6", "7-9"] as const;
export type HskBand = (typeof HSK_BANDS)[number];

export const ITEM_TYPES = ["vocab", "grammar", "character", "topic", "task"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const VOCAB_NEW_ENTRIES_BY_BAND: Readonly<Record<HskBand, number>> = {
  "1": 300,
  "2": 200,
  "3": 500,
  "4": 1000,
  "5": 1600,
  "6": 1800,
  "7-9": 5600,
};

export const VOCAB_TOTAL_ENTRIES = 11_000;

export function isHskBand(value: unknown): value is HskBand {
  return typeof value === "string" && (HSK_BANDS as readonly string[]).includes(value);
}

/** Cumulative numbered entries up to and including the given band. */
export function cumulativeVocabEntries(band: HskBand): number {
  let total = 0;
  for (const b of HSK_BANDS) {
    total += VOCAB_NEW_ENTRIES_BY_BAND[b];
    if (b === band) break;
  }
  return total;
}

export interface CurriculumItemKey {
  editionId: string;
  itemType: ItemType;
  sourceId: number;
}

/** Immutable item identity: `edition:type:sourceId` (SPEC §8.1). */
export function makeCurriculumItemId(key: CurriculumItemKey): string {
  return `${key.editionId}:${key.itemType}:${key.sourceId}`;
}

const ITEM_ID_PATTERN = /^([a-z0-9][a-z0-9-]*):([a-z]+):([1-9][0-9]*)$/;

/** Parses an item id, returning null for anything that is not well formed. */
export function parseCurriculumItemId(id: string): CurriculumItemKey | null {
  const match = ITEM_ID_PATTERN.exec(id);
  if (!match) return null;
  const [, editionId, itemType, sourceId] = match;
  if (!editionId || !sourceId || !(ITEM_TYPES as readonly string[]).includes(itemType ?? "")) {
    return null;
  }
  return { editionId, itemType: itemType as ItemType, sourceId: Number(sourceId) };
}
