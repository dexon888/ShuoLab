import { describe, expect, it } from "vitest";
import { parseAssessment, pronunciationAttemptRequestSchema, weakest } from "../../src/shared/pronunciation";

// Shaped like Azure's detailed pronunciation-assessment JSON (SPEC §7.3).
const azure = JSON.stringify({
  DisplayText: "你好。",
  NBest: [
    {
      Display: "你好。",
      PronunciationAssessment: { AccuracyScore: 72.5, FluencyScore: 90, CompletenessScore: 100, PronScore: 80.1 },
      Words: [
        { Word: "你", PronunciationAssessment: { AccuracyScore: 95, ErrorType: "None" } },
        { Word: "好", PronunciationAssessment: { AccuracyScore: 41, ErrorType: "Mispronunciation" } },
      ],
    },
  ],
});

describe("parseAssessment", () => {
  it("reads the scores and each character", () => {
    expect(parseAssessment(azure)).toEqual({
      scores: { accuracy: 72.5, fluency: 90, completeness: 100, pronunciation: 80.1 },
      words: [
        { text: "你", accuracy: 95, error: "None" },
        { text: "好", accuracy: 41, error: "Mispronunciation" },
      ],
      recognized: "你好。",
    });
  });

  it("returns null without an assessment or for bad JSON", () => {
    expect(parseAssessment(null)).toBeNull();
    expect(parseAssessment("{")).toBeNull();
    expect(parseAssessment(JSON.stringify({ NBest: [{ Display: "x" }] }))).toBeNull();
  });

  it("clamps scores and drops empty words", () => {
    const r = parseAssessment(JSON.stringify({ NBest: [{ PronunciationAssessment: { AccuracyScore: 140, FluencyScore: -3 }, Words: [{ Word: "" }, { Word: "好" }] }] }));
    expect(r?.scores).toEqual({ accuracy: 100, fluency: 0, completeness: 0, pronunciation: 0 });
    expect(r?.words).toEqual([{ text: "好", accuracy: 0, error: "None" }]);
  });
});

describe("weakest", () => {
  it("lists the least clear characters, worst first", () => {
    const words = [
      { text: "我", accuracy: 90, error: "None" },
      { text: "是", accuracy: 55, error: "None" },
      { text: "学", accuracy: 30, error: "Mispronunciation" },
      { text: "生", accuracy: 85, error: "Omission" },
    ];
    expect(weakest(words).map((w) => w.text)).toEqual(["学", "是", "生"]);
    expect(weakest(words, 1).map((w) => w.text)).toEqual(["学"]);
    expect(weakest([{ text: "好", accuracy: 95, error: "None" }])).toEqual([]);
  });
});

describe("attempt request", () => {
  it("takes scores but has no field for audio", () => {
    const body = { sessionId: null, referenceText: "你好", scores: { accuracy: 80, fluency: 80, completeness: 100, pronunciation: 82 }, words: [], audioSeconds: 2 };
    expect(pronunciationAttemptRequestSchema.safeParse(body).success).toBe(true);
    expect(pronunciationAttemptRequestSchema.safeParse({ ...body, audio: "UklGR..." }).success).toBe(false);
  });
});
