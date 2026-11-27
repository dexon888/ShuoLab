import { describe, expect, it } from "vitest";
import { buildSsml } from "../../src/client/speech/ssml";
import { ALL_UNITS, TONE_CHECK, UNITS, scoreUnit } from "../../src/shared/onramp";

describe("the sound-system on-ramp content (SPEC §5.9, FR-032)", () => {
  it("has a key among the options for every chosen item and a phoneme for every listening item", () => {
    for (const unit of ALL_UNITS) {
      for (const item of unit.items) {
        if (unit.mode === "type") {
          expect(item.text.length).toBeGreaterThan(0);
          continue;
        }
        expect(item.options[item.answer], `${unit.id} ${item.text}`).toBeDefined();
        expect(new Set(item.options).size).toBe(item.options.length);
        if (unit.mode === "listen") expect(item.phoneme, `${unit.id} ${item.text}`).toMatch(/^[a-z]+ [1-5]( [a-z]+ [1-5])*$/);
      }
    }
  });

  it("keeps the tone check's syllables out of the units", () => {
    const drilled = new Set(UNITS.flatMap((u) => u.items.map((i) => i.phoneme)).filter(Boolean));
    expect(TONE_CHECK.items.some((i) => drilled.has(i.phoneme))).toBe(false);
    expect(TONE_CHECK.items).toHaveLength(20);
  });

  it("scores choices by key and typing by the characters, ignoring spaces", () => {
    const tones = UNITS[0];
    if (!tones) throw new Error("no unit");
    const right = tones.items.map((i) => i.answer);
    expect(scoreUnit(tones, right).marks.every(Boolean)).toBe(true);
    const typing = UNITS.find((u) => u.mode === "type");
    if (!typing) throw new Error("no typing unit");
    const { marks } = scoreUnit(typing, typing.items.map((i, n) => (n === 0 ? "你 好" : n === 1 ? "找" : i.text)));
    expect(marks.slice(0, 3)).toEqual([true, false, true]);
  });
});

describe("speaking a drill sound exactly (SPEC §5.9)", () => {
  it("wraps the text in a sapi phoneme and uses the chosen voice", () => {
    const ssml = buildSsml("妈", 0.9, "zh-CN-YunxiNeural", "ma 1");
    expect(ssml).toContain('<voice name="zh-CN-YunxiNeural">');
    expect(ssml).toContain('<phoneme alphabet="sapi" ph="ma 1">妈</phoneme>');
  });

  it("ignores an unknown voice or a malformed phoneme", () => {
    const ssml = buildSsml("妈", 1, "en-US-Evil", 'ma 1"><evil/>');
    expect(ssml).toContain('<voice name="zh-CN-XiaoxiaoNeural">');
    expect(ssml).not.toContain("phoneme");
    expect(ssml).not.toContain("<evil");
  });
});
