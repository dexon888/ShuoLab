import { describe, expect, it } from "vitest";
import {
  HSK_BANDS,
  VOCAB_NEW_ENTRIES_BY_BAND,
  VOCAB_TOTAL_ENTRIES,
  cumulativeVocabEntries,
  isHskBand,
  makeCurriculumItemId,
  parseCurriculumItemId,
} from "../../src/shared/curriculum";

describe("HSK 3.0 (November 2025) published totals — SPEC §2.1", () => {
  it("has the published first-introduction count for each band", () => {
    expect(VOCAB_NEW_ENTRIES_BY_BAND).toEqual({
      "1": 300,
      "2": 200,
      "3": 500,
      "4": 1000,
      "5": 1600,
      "6": 1800,
      "7-9": 5600,
    });
  });

  it("has the published cumulative count for each band", () => {
    expect(HSK_BANDS.map(cumulativeVocabEntries)).toEqual([300, 500, 1000, 2000, 3600, 5400, 11000]);
  });

  it("sums to exactly 11,000 numbered entries", () => {
    const sum = HSK_BANDS.reduce((n, band) => n + VOCAB_NEW_ENTRIES_BY_BAND[band], 0);
    expect(sum).toBe(VOCAB_TOTAL_ENTRIES);
    expect(VOCAB_TOTAL_ENTRIES).toBe(11000);
  });

  it("treats 7–9 as one shared band", () => {
    expect(isHskBand("7-9")).toBe(true);
    for (const invalid of ["7", "8", "9", "0", "10", "", 1, null, undefined]) {
      expect(isHskBand(invalid)).toBe(false);
    }
  });
});

describe("curriculum item ids", () => {
  it("round-trips edition:type:sourceId", () => {
    const key = { editionId: "hsk3-2025-11", itemType: "vocab", sourceId: 42 } as const;
    const id = makeCurriculumItemId(key);
    expect(id).toBe("hsk3-2025-11:vocab:42");
    expect(parseCurriculumItemId(id)).toEqual(key);
  });

  it.each([
    "",
    "hsk3-2025-11:vocab",
    "hsk3-2025-11:vocab:0",
    "hsk3-2025-11:vocab:-1",
    "hsk3-2025-11:vocab:1.5",
    "hsk3-2025-11:vocab:abc",
    "hsk3-2025-11:slang:1",
    "hsk3-2025-11:vocab:1:extra",
    " hsk3-2025-11:vocab:1",
  ])("rejects malformed id %j", (id) => {
    expect(parseCurriculumItemId(id)).toBeNull();
  });
});
