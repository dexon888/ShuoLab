import { describe, expect, it } from "vitest";
import { CsvFormatError, parseCsv } from "../../src/server/services/curriculum-import";

const cells = (text: string) => parseCsv(text).map((row) => row.cells);

describe("parseCsv", () => {
  it("reads plain rows with LF or CRLF endings", () => {
    expect(cells("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(cells("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(cells("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty cells, including a trailing one", () => {
    expect(cells("14,不客气,,1\n")).toEqual([["14", "不客气", "", "1"]]);
    expect(cells("a,b,\n")).toEqual([["a", "b", ""]]);
  });

  it("handles quoted commas, escaped quotes and line breaks inside quotes", () => {
    expect(cells('1,"a,b","say ""hi""","line1\nline2"\n')).toEqual([
      ["1", "a,b", 'say "hi"', "line1\nline2"],
    ]);
  });

  it("does not split on the Chinese enumeration comma", () => {
    expect(cells("7,数、（副）,半\n")).toEqual([["7", "数、（副）", "半"]]);
  });

  it("skips blank lines and reports the line each row starts on", () => {
    const rows = parseCsv('h\n\n"a\nb"\nc\n');
    expect(rows.map((r) => [r.line, r.cells])).toEqual([
      [1, ["h"]],
      [3, ["a\nb"]],
      [5, ["c"]],
    ]);
  });

  it("rejects an unterminated quote and reports where it opened", () => {
    expect(() => parseCsv('a\n"oops\nmore\n')).toThrow(CsvFormatError);
    try {
      parseCsv('a\n"oops\nmore\n');
    } catch (error) {
      expect((error as CsvFormatError).line).toBe(2);
    }
  });

  it("rejects stray quotes rather than guessing", () => {
    expect(() => parseCsv('ab"c,d\n')).toThrow(CsvFormatError);
    expect(() => parseCsv('"a"b,c\n')).toThrow(CsvFormatError);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});
