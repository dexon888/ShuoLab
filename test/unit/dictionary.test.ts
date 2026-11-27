import { describe, expect, it } from "vitest";
import { matchGlosses, parseCedict, pinyinKey } from "../../src/server/services/dictionary";

// Lines in CC-CEDICT format, written for this test.
const SAMPLE = [
  "# CC-CEDICT",
  "爸爸 爸爸 [ba4 ba5] /father (informal)/CL:個|个[ge4],位[wei4]/",
  "好 好 [hao3] /good/well/",
  "好 好 [hao4] /to be fond of/",
  "一點兒 一点儿 [yi1 dian3 r5] /a little/",
  "女 女 [nu:3] /female/woman/",
  "this line is broken",
].join("\n");

describe("reading CC-CEDICT (SPEC §2.6 rule 2, FR-033)", () => {
  it("parses entries and skips comments and broken lines", () => {
    const { entries, skipped } = parseCedict(SAMPLE);
    expect(entries.map((e) => e.simplified)).toEqual(["爸爸", "好", "好", "一点儿", "女"]);
    expect(entries[0]?.senses).toEqual(["father (informal)", "CL:個|个[ge4],位[wei4]"]);
    expect(skipped).toBe(1);
  });

  it("compares marked and numbered pinyin, neutral tones and ü included", () => {
    expect(pinyinKey("bàba", false)).toBe(pinyinKey("ba4 ba5", true));
    expect(pinyinKey("nǚ", false)).toBe(pinyinKey("nu:3", true));
    expect(pinyinKey("Běijīng", false)).toBe(pinyinKey("Bei3 jing1", true));
    expect(pinyinKey("xī'ān", false)).toBe(pinyinKey("Xi1 an1", true));
  });

  it("matches by characters and pinyin, keeps only the matching reading, and labels each meaning", () => {
    const { entries } = parseCedict(SAMPLE);
    const result = matchGlosses(
      [
        { id: "a", hanzi: "爸爸", pinyin: "bàba" },
        { id: "b", hanzi: "好1", pinyin: "hǎo" },
        { id: "c", hanzi: "一点儿", pinyin: "yīdiǎnr" },
        { id: "d", hanzi: "女", pinyin: "lǜ" },
        { id: "e", hanzi: "猫", pinyin: "māo" },
      ],
      entries,
    );
    expect(result).toMatchObject({ byPinyin: 3, byCharacters: 1, missing: 1 });
    const by = Object.fromEntries(result.glosses.map((g) => [g.id, g]));
    expect(by.b?.definition).toBe("good; well");
    expect(by.c?.definition).toBe("a little");
    expect(by.a?.provenance).toMatch(/^CC-CEDICT \(CC BY-SA 4\.0\), matched by characters and pinyin\. Not HSK content\.$/);
    expect(by.d?.provenance).toMatch(/matched by characters only/);
  });
});
