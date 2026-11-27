import { describe, expect, it } from "vitest";
import { coverage, coverageTarget, replySentences, segment } from "../../src/shared/coverage";

const vocab = new Set(["你好", "朋友", "我", "是", "学生", "喜欢", "吃", "米饭", "米"]);

describe("known-word coverage (SPEC §2.6 rule 4, FR-035)", () => {
  it("segments by the longest vocabulary word, single characters otherwise, ignoring punctuation and Latin", () => {
    expect(segment("你好！我是学生。OK", vocab)).toEqual(["你好", "我", "是", "学生"]);
    expect(segment("我喜欢吃米饭和面", vocab)).toEqual(["我", "喜欢", "吃", "米饭", "和", "面"]);
  });

  it("counts the share of tokens the learner has met and lists the rest once", () => {
    expect(coverage("我喜欢吃米饭和面，和你", vocab, new Set(["我", "喜欢", "吃"]))).toEqual({ known: 3, total: 8, unknown: ["米饭", "和", "面", "你"] });
  });

  it("holds 90% for beginners and 95% after 300 words, and nothing under 100", () => {
    expect(coverageTarget(40)).toBeNull();
    expect(coverageTarget(150)).toBe(0.9);
    expect(coverageTarget(900)).toBe(0.95);
  });

  it("lets replies grow with the learner's own turns", () => {
    expect([replySentences(3), replySentences(12), replySentences(30)]).toEqual([1, 2, 3]);
  });
});
