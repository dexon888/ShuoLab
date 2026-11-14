import { describe, expect, it } from "vitest";
import {
  formatRanges,
  renderSqlScript,
  type PrepareImportResult,
} from "../../src/server/services/curriculum-import";
import { ACTIVE_EDITION_ID, HSK_BANDS, SYNTHETIC_EDITION_ID } from "../../src/shared/curriculum";
import {
  SYNTHETIC_HOMOGRAPH_IDS,
  makeSyntheticRecords,
  recordsForBand,
  toCsv,
  toJson,
  type SyntheticRecord,
} from "../fixtures/synthetic-vocab";
import { issueCodes, prepare, sourceFile } from "../helpers/import";

const records = makeSyntheticRecords();

function importCsv(rows: readonly SyntheticRecord[], editionId?: string): PrepareImportResult {
  return prepare([sourceFile("all.csv", toCsv(rows))], editionId);
}

/** A copy of the fixture with one record changed. */
function withRecord(id: number, change: Partial<Record<keyof SyntheticRecord, unknown>>): SyntheticRecord[] {
  return records.map((r) => (r.id === id ? ({ ...r, ...change } as SyntheticRecord) : r));
}

function messages(result: PrepareImportResult, code: string): string[] {
  return result.ok ? [] : result.issues.filter((i) => i.code === code).map((i) => i.message);
}

describe("synthetic fixture", () => {
  it("has the edition's shape: 11,000 ids, continuous, with the published band sizes", () => {
    expect(records).toHaveLength(11000);
    expect(records.map((r) => r.id)).toEqual(Array.from({ length: 11000 }, (_, i) => i + 1));
    expect(HSK_BANDS.map((b) => recordsForBand(records, b).length)).toEqual([
      300, 200, 500, 1000, 1600, 1800, 5600,
    ]);
  });

  it("is recognisably synthetic", () => {
    expect(records.every((r) => r.hanzi.startsWith("样例"))).toBe(true);
  });
});

describe("accepting a complete, valid dataset (FR-003)", () => {
  it("accepts the single complete CSV with a BOM", () => {
    const result = importCsv(records);
    expect(issueCodes(result)).toEqual([]);
    if (!result.ok) return;
    expect(result.summary.totalEntries).toBe(11000);
    expect(result.summary.entriesByBand).toEqual({
      "1": 300, "2": 200, "3": 500, "4": 1000, "5": 1600, "6": 1800, "7-9": 5600,
    });
    expect(result.summary.synthetic).toBe(true);
  });

  it("accepts the same data without a BOM, as JSON, and with CRLF line endings", () => {
    expect(prepare([sourceFile("all.csv", toCsv(records, { bom: false }))]).ok).toBe(true);
    expect(prepare([sourceFile("all.json", toJson(records))]).ok).toBe(true);
    expect(prepare([sourceFile("all.csv", toCsv(records).replaceAll("\n", "\r\n"))]).ok).toBe(true);
  });

  it("accepts the seven per-level new-entry files, in any order", () => {
    const files = [...HSK_BANDS]
      .reverse()
      .map((band) => sourceFile(`hsk-${band}.csv`, toCsv(recordsForBand(records, band))));
    const result = prepare(files);
    expect(issueCodes(result)).toEqual([]);
    if (result.ok) expect(result.summary.files).toHaveLength(7);
  });

  it("accepts columns in a different order and ignores extra columns", () => {
    const head = "extra,source_pdf_page,level_label,homograph,entry,part_of_speech,pinyin,hanzi,level,id";
    const body = records
      .map((r) =>
        ["x", r.source_pdf_page, r.level_label, r.homograph ?? "", r.entry, r.part_of_speech ?? "", r.pinyin, r.hanzi, r.level, r.id].join(","),
      )
      .join("\n");
    expect(prepare([sourceFile("all.csv", `${head}\n${body}\n`)]).ok).toBe(true);
  });

  it("is deterministic: the same files produce the same statements", () => {
    const a = importCsv(records);
    const b = importCsv(records);
    expect(a.ok && b.ok && JSON.stringify(a.statements) === JSON.stringify(b.statements)).toBe(true);
  });
});

describe("homograph identity (SPEC §2.1, §2.2 #4)", () => {
  it("keeps entries that share a written form as separate numbered items", () => {
    const result = importCsv(records);
    if (!result.ok) throw new Error("expected a valid import");
    const [first, second] = SYNTHETIC_HOMOGRAPH_IDS;
    const stored = result.statements
      .filter((s) => s.sql.includes("INSERT INTO curriculum_items"))
      .flatMap((s) => JSON.parse(String(s.params[1])) as Record<string, unknown>[])
      .filter((row) => row.source_id === first || row.source_id === second);

    expect(stored).toHaveLength(2);
    expect(stored[0]?.hanzi).toBe(stored[1]?.hanzi);
    expect(stored.map((r) => r.id)).toEqual([
      `${SYNTHETIC_EDITION_ID}:vocab:${first}`,
      `${SYNTHETIC_EDITION_ID}:vocab:${second}`,
    ]);
    expect(stored.map((r) => r.homograph)).toEqual(["1", "2"]);
    expect(stored.map((r) => r.entry_raw)).toEqual(["样例同形词1", "样例同形词2"]);
    expect(result.summary.homographEntries).toBe(2);
  });

  it("preserves entry, level label and source page exactly", () => {
    const result = importCsv(records);
    if (!result.ok) throw new Error("expected a valid import");
    const rows = result.statements
      .filter((s) => s.sql.includes("INSERT INTO curriculum_items"))
      .flatMap((s) => JSON.parse(String(s.params[1])) as Record<string, unknown>[]);
    const row50 = rows.find((r) => r.source_id === 50);
    expect(row50).toMatchObject({ level_label: "1（2）", hsk_band: "1", source_pdf_page: 80 });
    expect(rows.find((r) => r.source_id === 7)?.part_of_speech).toBeNull();
  });
});

describe("rejecting tampered or incomplete data (FR-004)", () => {
  it("rejects a duplicated id and says how to fix it", () => {
    const result = importCsv([...records, records[41] as SyntheticRecord]);
    expect(issueCodes(result)).toEqual(["DUPLICATE_ID", "TOTAL_MISMATCH"]);
    expect(messages(result, "DUPLICATE_ID")[0]).toMatch(/id 42 appears more than once.*never the cumulative lists/s);
  });

  it("rejects cumulative files mixed with per-level files", () => {
    const hsk1 = recordsForBand(records, "1");
    const files = [
      ...HSK_BANDS.map((band) => sourceFile(`hsk-${band}.csv`, toCsv(recordsForBand(records, band)))),
      sourceFile("cumulative-hsk-1.csv", toCsv(hsk1)),
    ];
    const result = prepare(files);
    expect(result.ok).toBe(false);
    expect(messages(result, "DUPLICATE_ID")).toHaveLength(300);
  });

  it("rejects an entry moved to the wrong level", () => {
    const result = importCsv(withRecord(5, { level: "2" }));
    expect(issueCodes(result)).toEqual(["BAND_COUNT_MISMATCH"]);
    expect(messages(result, "BAND_COUNT_MISMATCH")).toEqual([
      expect.stringContaining("HSK 1: found 299"),
      expect.stringContaining("HSK 2: found 201"),
    ]);
  });

  it("rejects a missing entry and names the missing id", () => {
    const result = importCsv(records.filter((r) => r.id !== 4321));
    expect(issueCodes(result)).toEqual(["BAND_COUNT_MISMATCH", "MISSING_IDS", "TOTAL_MISMATCH"]);
    expect(messages(result, "MISSING_IDS")[0]).toContain("1 of 11000 numbered entries are missing: 4321.");
  });

  it("rejects an extra entry beyond the edition's range", () => {
    const extra = { ...(records[0] as SyntheticRecord), id: 11001, level: "7-9" };
    const result = importCsv([...records, extra]);
    expect(issueCodes(result)).toEqual(["ID_OUT_OF_RANGE", "TOTAL_MISMATCH"]);
  });

  it.each(["7", "8", "9", "0", "HSK1", "7–9", "advanced"])(
    "rejects unknown level code %j, including separate 7, 8 and 9",
    (level) => {
      const result = importCsv(withRecord(6000, { level }));
      expect(issueCodes(result)).toContain("UNKNOWN_LEVEL");
      expect(messages(result, "UNKNOWN_LEVEL")[0]).toContain('one shared band written "7-9"');
    },
  );

  it.each([
    ["id", "abc", "INVALID_ID"],
    ["id", "0", "INVALID_ID"],
    ["id", "1.5", "INVALID_ID"],
    ["id", "", "INVALID_ID"],
    ["hanzi", "", "MISSING_FIELD"],
    ["pinyin", "  ", "MISSING_FIELD"],
    ["entry", "", "MISSING_FIELD"],
    ["level", "", "MISSING_FIELD"],
    ["level_label", "", "MISSING_FIELD"],
    ["source_pdf_page", "", "MISSING_FIELD"],
    ["source_pdf_page", "p80", "INVALID_PAGE"],
    ["homograph", "x", "INVALID_HOMOGRAPH"],
    ["hanzi", "样�词", "CORRUPT_TEXT"],
  ] as const)("rejects %s = %j with %s", (field, value, code) => {
    const result = importCsv(withRecord(77, { [field]: value }));
    expect(issueCodes(result)).toContain(code);
    if (!result.ok) {
      const issue = result.issues.find((i) => i.code === code);
      expect(issue).toMatchObject({ file: "all.csv", position: 78 });
    }
  });

  it("rejects bytes that are not valid UTF-8", () => {
    const good = new TextEncoder().encode(toCsv(records));
    const bad = new Uint8Array(good.length + 2);
    bad.set(good);
    bad.set([0xc3, 0x28], good.length);
    expect(issueCodes(prepare([sourceFile("all.csv", bad)]))).toContain("INVALID_UTF8");
  });

  it("rejects a file with a missing column, a ragged row, bad JSON or an unsupported shape", () => {
    expect(issueCodes(prepare([sourceFile("a.csv", "id,level,hanzi\n1,1,样\n")]))).toContain("MISSING_COLUMN");
    const ragged = toCsv(records).replace("\n2,1,", "\n2,1,extra,");
    expect(issueCodes(prepare([sourceFile("a.csv", ragged)]))).toContain("BAD_FORMAT");
    expect(issueCodes(prepare([sourceFile("a.json", "{not json")]))).toContain("BAD_FORMAT");
    expect(issueCodes(prepare([sourceFile("a.json", '{"id":1}')]))).toContain("BAD_FORMAT");
    expect(issueCodes(prepare([sourceFile("a.csv", "")]))).toContain("BAD_FORMAT");
  });

  it("rejects an empty directory and an unknown edition", () => {
    expect(issueCodes(prepare([]))).toEqual(["NO_FILES"]);
    expect(issueCodes(importCsv(records, "hsk2-2012"))).toEqual(["UNKNOWN_EDITION"]);
  });

  it("produces no statements at all when anything is wrong", () => {
    const result = importCsv(withRecord(5, { level: "2" }));
    expect(result.ok).toBe(false);
    expect("statements" in result).toBe(false);
  });
});

describe("edition identity", () => {
  it("keys items by edition, so the same source id never collides across editions", () => {
    const synthetic = importCsv(records, SYNTHETIC_EDITION_ID);
    const real = importCsv(records, ACTIVE_EDITION_ID);
    if (!synthetic.ok || !real.ok) throw new Error("expected valid imports");
    const firstId = (r: typeof synthetic) =>
      (JSON.parse(String(r.statements[2]?.params[1])) as { id: string }[])[0]?.id;
    expect(firstId(synthetic)).toBe("synthetic-fixture:vocab:1");
    expect(firstId(real)).toBe("hsk3-2025-11:vocab:1");
    expect(real.summary.synthetic).toBe(false);
  });
});

describe("helpers", () => {
  it("formats id ranges compactly", () => {
    expect(formatRanges([1, 2, 3, 7, 9, 10])).toBe("1–3, 7, 9–10");
    expect(formatRanges([])).toBe("");
    expect(formatRanges([1, 3, 5, 7], 2)).toBe("1, 3 and 2 more ranges");
  });

  it("renders SQL literals safely and substitutes parameters in one pass", () => {
    const script = renderSqlScript([
      { sql: "INSERT INTO t (a, b, c)\nVALUES (?1, ?2, ?3)", params: ["it's ?2 here", null, 7] },
      { sql: "UPDATE t SET a = ?10 WHERE b = ?1", params: ["one", 2, 3, 4, 5, 6, 7, 8, 9, "ten"] },
    ]);
    expect(script).toBe(
      "INSERT INTO t (a, b, c) VALUES ('it''s ?2 here', NULL, 7);\n" +
        "UPDATE t SET a = 'ten' WHERE b = 'one';\n",
    );
  });
});
