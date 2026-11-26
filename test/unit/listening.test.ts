import { describe, expect, it, vi } from "vitest";
import { fakeListeningOutput } from "../../src/server/providers/fake";
import { OpenAiTutorProvider } from "../../src/server/providers/openai";
import type { TutorRequest } from "../../src/server/providers/types";
import { isUnassisted } from "../../src/server/services/listening";
import {
  PREPARED_LISTENING,
  buildListeningInstructions,
  parseListeningOutput,
  toStored,
} from "../../src/server/services/listening-prompt";
import { buildFreeChatPlan, buildHskPlan } from "../../src/server/services/planner";
import { FREE_CHAT_SITUATION, situationFor } from "../../src/server/services/situations";
import {
  LISTENING_FORMAT_NAME,
  LISTENING_OUTPUT_JSON_SCHEMA,
  listeningOutputSchema,
  type ListeningOutput,
} from "../../src/shared/listening";

const TARGETS = [
  { id: "test:vocab:301", hanzi: "周末", pinyin: "zhōumò" },
  { id: "test:vocab:302", hanzi: "朋友", pinyin: "péngyou" },
];

const hskPlan = buildHskPlan({
  editionId: "test",
  synthetic: true,
  targetBand: "2",
  bandSource: "owner_choice",
  durationMinutes: 15,
  localStudyDate: "2026-03-04",
  situation: situationFor(0),
  activeCandidates: TARGETS.map((t, i) => ({ id: t.id, sourceId: 301 + i, hskBand: "2" as const, hanzi: t.hanzi, pinyin: t.pinyin })),
  reviewCandidates: [],
  stretchCandidates: [],
  colloquial: null,
});

const request: TutorRequest = {
  instructions: "write an exercise",
  messages: [{ role: "user", content: "Write the listening exercise." }],
  context: { targets: TARGETS, colloquial: [], turnIndex: 0, attempt: 1 },
};

const valid = (over: Partial<ListeningOutput> = {}): string => JSON.stringify({ ...PREPARED_LISTENING, ...over });

describe("listening exercise contract (SPEC §6.4)", () => {
  it("accepts the prepared exchange and the stand-in's", () => {
    expect(parseListeningOutput(valid())).toMatchObject({ ok: true });
    expect(parseListeningOutput(JSON.stringify(fakeListeningOutput(request)))).toMatchObject({ ok: true });
    expect(parseListeningOutput(JSON.stringify(fakeListeningOutput({ ...request, context: { ...request.context, targets: [] } })))).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["nothing", null, "no_output"],
    ["blank text", "  ", "no_output"],
    ["prose", "Here is your exercise", "not_json"],
    ["one line", valid({ lines: PREPARED_LISTENING.lines.slice(0, 1) }), "schema"],
    ["one question", valid({ questions: PREPARED_LISTENING.questions.slice(0, 1) }), "schema"],
    ["English lines", valid({ lines: PREPARED_LISTENING.lines.map((l) => ({ ...l, zh: "Are you free this weekend?" })) }), "schema"],
    ["two options", valid({ questions: PREPARED_LISTENING.questions.map((q) => ({ ...q, options_en: q.options_en.slice(0, 2) })) }), "schema"],
    ["an answer out of range", valid({ questions: PREPARED_LISTENING.questions.map((q) => ({ ...q, answer_index: 3 })) }), "schema"],
    ["repeated options", valid({ questions: PREPARED_LISTENING.questions.map((q) => ({ ...q, options_en: ["Yes", "yes", "No"] })) }), "schema"],
    ["an extra field", JSON.stringify({ ...PREPARED_LISTENING, hsk_level: 2 }), "schema"],
    ["a third speaker", valid({ lines: PREPARED_LISTENING.lines.map((l) => ({ ...l, speaker: "C" as "A" })) }), "schema"],
  ])("rejects %s", (_name, text, reason) => {
    expect(parseListeningOutput(text)).toEqual({ ok: false, reason });
  });

  it("keeps the JSON Schema sent to the provider in step with the Zod schema", () => {
    const shape = listeningOutputSchema.shape;
    expect([...LISTENING_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(Object.keys(shape).sort());
    const line = LISTENING_OUTPUT_JSON_SCHEMA.properties.lines.items;
    const question = LISTENING_OUTPUT_JSON_SCHEMA.properties.questions.items;
    expect([...line.required].sort()).toEqual(Object.keys(shape.lines.element.shape).sort());
    expect([...question.required].sort()).toEqual(Object.keys(shape.questions.element.shape).sort());
    expect([LISTENING_OUTPUT_JSON_SCHEMA, line, question].every((s) => s.additionalProperties === false)).toBe(true);
  });
});

describe("shuffling the options", () => {
  it("moves the right answer with its option", () => {
    // Reverses each set of three options.
    const randoms = [0.99, 0];
    let i = 0;
    const stored = toStored(PREPARED_LISTENING, () => randoms[i++ % randoms.length] as number);
    stored.questions.forEach((q, qi) => {
      const original = PREPARED_LISTENING.questions[qi];
      expect(q.optionsEn.slice().sort()).toEqual(original?.options_en.slice().sort());
      expect(q.optionsEn[q.answerIndex]).toBe(original?.options_en[original.answer_index]);
    });
  });

  it("does not always leave the right answer first", () => {
    const positions = new Set<number>();
    for (let n = 0; n < 30; n += 1) positions.add(toStored(PREPARED_LISTENING).questions[0]?.answerIndex ?? -1);
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe("listening instructions", () => {
  it("names the situation, the band and the session's words, and asks for English questions", () => {
    const text = buildListeningInstructions(hskPlan, TARGETS, null);
    expect(text).toContain(hskPlan.situation.titleZh);
    expect(text).toContain("HSK 2");
    expect(text).toContain("周末 (zhōumò)");
    expect(text).toMatch(/questions in English/);
    expect(text).toMatch(/Never state an HSK level/);
    expect(text).not.toMatch(/previous answer/);
  });

  it("has no syllabus words or band for an open conversation", () => {
    const plan = buildFreeChatPlan({ durationMinutes: 15, localStudyDate: "2026-03-04", situation: FREE_CHAT_SITUATION });
    const text = buildListeningInstructions(plan, [], null);
    expect(text).not.toMatch(/HSK \d/);
  });

  it("says what was wrong on the retry", () => {
    expect(buildListeningInstructions(hskPlan, TARGETS, "schema")).toMatch(/previous answer did not match/);
  });
});

describe("unassisted listening (SPEC §10)", () => {
  it("counts answers given before the text was shown, or with no reveal at all", () => {
    expect(isUnassisted("2026-03-04T10:00:00.000Z", null)).toBe(true);
    expect(isUnassisted("2026-03-04T10:00:00.000Z", "2026-03-04T10:01:00.000Z")).toBe(true);
    expect(isUnassisted("2026-03-04T10:02:00.000Z", "2026-03-04T10:01:00.000Z")).toBe(false);
  });
});

describe("OpenAI adapter with the listening format", () => {
  it("sends the listening schema, its token limit and its own timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: valid() }] }], usage: {} }),
    );
    const provider = new OpenAiTutorProvider({ apiKey: "sk-test-not-a-real-key", model: "gpt-6-luna", prices: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 }, fetch: fetchMock });
    const result = await provider.generate({
      ...request,
      format: { name: LISTENING_FORMAT_NAME, schema: LISTENING_OUTPUT_JSON_SCHEMA, maxOutputTokens: 1400, timeoutMs: 25_000 },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.text.format).toEqual({ type: "json_schema", name: LISTENING_FORMAT_NAME, schema: LISTENING_OUTPUT_JSON_SCHEMA, strict: true });
    expect(body.max_output_tokens).toBe(1400);
    expect(body.store).toBe(false);
    expect(parseListeningOutput(result.text)).toMatchObject({ ok: true });
  });
});
