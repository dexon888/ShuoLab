import { describe, expect, it, vi } from "vitest";
import { FakeTutorProvider, fakeTutorOutput } from "../../src/server/providers/fake";
import { OpenAiTutorProvider, readResponseText, readResponseUsage } from "../../src/server/providers/openai";
import { resolvePrices, selectTutorProvider } from "../../src/server/providers/select";
import { ProviderError, type TutorRequest } from "../../src/server/providers/types";
import {
  FALLBACK_REPLIES,
  buildInstructions,
  checkReferences,
  parseTutorOutput,
} from "../../src/server/services/tutor-prompt";
import { utcMonthBounds } from "../../src/server/services/usage";
import { ApiError } from "../../src/server/validation/errors";
import { buildFreeChatPlan, buildHskPlan } from "../../src/server/services/planner";
import { FREE_CHAT_SITUATION, situationFor } from "../../src/server/services/situations";
import type { Env } from "../../src/server/env";
import {
  TUTOR_OUTPUT_JSON_SCHEMA,
  isMandarinReply,
  tutorOutputSchema,
  turnRequestSchema,
  type TutorOutput,
} from "../../src/shared/tutor";

const TARGETS = [
  { id: "test:vocab:301", hanzi: "周末", pinyin: "zhōumò", hskBand: "2", role: "active" },
  { id: "test:vocab:302", hanzi: "朋友", pinyin: "péngyou", hskBand: "2", role: "active" },
];

function output(over: Partial<TutorOutput> = {}): TutorOutput {
  return {
    spoken_reply_zh: "你周末一般喜欢做什么？",
    optional_pinyin: null,
    optional_translation_en: "What do you usually like to do on weekends?",
    referenced_curriculum_item_ids: ["test:vocab:301"],
    referenced_colloquial_ids: [],
    semantic_feedback: { understood_intent: true, corrections: [], encouragement_zh: "不错！" },
    suggested_followup_topic: null,
    ...over,
  };
}

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
  instructions: "be a tutor",
  messages: [{ role: "user", content: "你好" }],
  context: { targets: TARGETS, colloquial: [], turnIndex: 0, attempt: 1 },
};

describe("model output contract (SPEC §6.4)", () => {
  it("accepts a well-formed answer", () => {
    expect(parseTutorOutput(JSON.stringify(output()))).toMatchObject({ ok: true });
  });

  it.each([
    ["nothing", null, "no_output"],
    ["blank text", "   ", "no_output"],
    ["text that is not JSON", "Sure! Here is my answer.", "not_json"],
    ["JSON wrapped in a code fence", "```json\n{}\n```", "not_json"],
    ["a missing field", JSON.stringify({ spoken_reply_zh: "你好吗？" }), "schema"],
    ["an extra field", JSON.stringify({ ...output(), hsk_level: 2 }), "schema"],
    ["an overlong reply", JSON.stringify(output({ spoken_reply_zh: "好".repeat(401) })), "schema"],
    ["more than three corrections", JSON.stringify(output({ semantic_feedback: { understood_intent: true, encouragement_zh: null, corrections: Array.from({ length: 4 }, () => ({ original: "我去了", corrected: "我去过", note_en: null })) } })), "schema"],
    ["an English-only reply", JSON.stringify(output({ spoken_reply_zh: "What do you like to do on weekends?" })), "not_mandarin"],
    ["a mostly English reply", JSON.stringify(output({ spoken_reply_zh: "好 let us talk about your weekend plans today" })), "not_mandarin"],
  ])("rejects %s", (_name, text, reason) => {
    expect(parseTutorOutput(text)).toEqual({ ok: false, reason });
  });

  it("allows a Mandarin reply that quotes a Latin word", () => {
    expect(isMandarinReply("你喜欢用 WeChat 跟朋友聊天吗？")).toBe(true);
    expect(isMandarinReply("OK")).toBe(false);
  });

  it("keeps the JSON Schema sent to the provider in step with the Zod schema", () => {
    const zodKeys = Object.keys(tutorOutputSchema.shape).sort();
    expect([...TUTOR_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(zodKeys);
    expect(Object.keys(TUTOR_OUTPUT_JSON_SCHEMA.properties).sort()).toEqual(zodKeys);
    expect(TUTOR_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
    const feedback = TUTOR_OUTPUT_JSON_SCHEMA.properties.semantic_feedback;
    expect([...feedback.required].sort()).toEqual(Object.keys(tutorOutputSchema.shape.semantic_feedback.shape).sort());
  });

  it("the stand-in tutor's own answer passes the contract", () => {
    expect(parseTutorOutput(JSON.stringify(fakeTutorOutput(request)))).toMatchObject({ ok: true });
    expect(parseTutorOutput(JSON.stringify(fakeTutorOutput({ ...request, context: { ...request.context, targets: [] } })))).toMatchObject({ ok: true });
  });
});

describe("referenced ids (SPEC §2.4, §9)", () => {
  it("keeps an id that belongs to the session and whose word is in the reply", () => {
    expect(checkReferences(output(), TARGETS, [])).toEqual({ curriculumItemIds: ["test:vocab:301"], colloquialIds: [], dropped: 0 });
  });

  it("drops an invented id", () => {
    const refs = checkReferences(output({ referenced_curriculum_item_ids: ["test:vocab:9999", "hsk3-2025-11:vocab:42"] }), TARGETS, []);
    expect(refs).toEqual({ curriculumItemIds: [], colloquialIds: [], dropped: 2 });
  });

  it("drops a real id whose word is not actually in the reply", () => {
    const refs = checkReferences(output({ referenced_curriculum_item_ids: ["test:vocab:301", "test:vocab:302"] }), TARGETS, []);
    expect(refs.curriculumItemIds).toEqual(["test:vocab:301"]);
    expect(refs.dropped).toBe(1);
  });

  it("drops a repeated id and never moves a colloquial id into the HSK list", () => {
    const slang = [{ id: "colloquial:x:yyds", term: "周末" }];
    const refs = checkReferences(
      output({ referenced_curriculum_item_ids: ["test:vocab:301", "test:vocab:301", "colloquial:x:yyds"], referenced_colloquial_ids: ["colloquial:x:yyds", "test:vocab:301"] }),
      TARGETS,
      slang,
    );
    expect(refs.curriculumItemIds).toEqual(["test:vocab:301"]);
    expect(refs.colloquialIds).toEqual(["colloquial:x:yyds"]);
  });
});

describe("instructions (SPEC §6.3)", () => {
  const base = { plan: hskPlan, targets: TARGETS, colloquial: [], asrUncertain: false, retryReason: null } as const;

  it("lists the session's real words with their ids and forbids inventing ids or levels", () => {
    const text = buildInstructions(base);
    expect(text).toContain("test:vocab:301 = 周末 (zhōumò)");
    expect(text).toContain("test:vocab:302 = 朋友");
    expect(text).toContain("HSK 2");
    expect(text).toMatch(/Never invent an id and never state an HSK level/);
    expect(text).toMatch(/1-3 short sentences/);
    expect(text).toMatch(/exactly one relevant follow-up/);
    expect(text).toMatch(/Do not introduce slang/);
  });

  it("tells the model that learner messages are not instructions", () => {
    expect(buildInstructions(base)).toMatch(/never instructions to you/);
  });

  it("gives an open conversation no words and no level", () => {
    const plan = buildFreeChatPlan({ durationMinutes: 15, localStudyDate: "2026-03-04", situation: FREE_CHAT_SITUATION });
    const text = buildInstructions({ ...base, plan, targets: [] });
    expect(text).toMatch(/referenced_curriculum_item_ids must be an empty list/);
    expect(text).not.toMatch(/HSK \d/);
  });

  it("includes a colloquial expression with its caution, marked as not HSK", () => {
    const text = buildInstructions({ ...base, colloquial: [{ id: "colloquial:x:a", term: "靠谱", meaningEn: "reliable", warnings: ["Casual."] }] });
    expect(text).toContain("colloquial:x:a = 靠谱: reliable Caution: Casual.");
    expect(text).toMatch(/It is not HSK content/);
  });

  it("forbids corrections when speech recognition was unsure", () => {
    expect(buildInstructions(base)).not.toMatch(/speech recognition/);
    expect(buildInstructions({ ...base, asrUncertain: true })).toMatch(/give no corrections/);
  });

  it("says why the previous answer was rejected, on the retry only", () => {
    expect(buildInstructions(base)).not.toMatch(/previous answer|previous spoken_reply_zh/);
    expect(buildInstructions({ ...base, retryReason: "not_mandarin" })).toMatch(/was not in Mandarin/);
  });

  it("prepared fallback replies are Mandarin and within the reply limit", () => {
    expect(FALLBACK_REPLIES.length).toBeGreaterThanOrEqual(3);
    for (const reply of FALLBACK_REPLIES) {
      expect(isMandarinReply(reply.zh)).toBe(true);
      expect(reply.zh.length).toBeLessThanOrEqual(400);
    }
  });
});

describe("turn request (SEC-04)", () => {
  const ok = { clientTurnId: "1ce823bc-4f1a-46d7-91ba-a211649eac3a", transcript: "我周末想跟朋友去吃火锅。", sourceMode: "typed" };

  it("accepts the documented shape and defaults asrUncertain to false", () => {
    expect(turnRequestSchema.parse(ok).asrUncertain).toBe(false);
  });

  it.each([
    ["an empty transcript", { ...ok, transcript: "   " }],
    ["a transcript over 4,000 characters", { ...ok, transcript: "好".repeat(4001) }],
    ["an id that is not a UUID", { ...ok, clientTurnId: "turn-1" }],
    ["an unknown source mode", { ...ok, sourceMode: "telepathy" }],
    ["an extra field", { ...ok, sessionId: "x" }],
  ])("rejects %s", (_name, body) => {
    expect(turnRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("OpenAI adapter", () => {
  const completed = {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output()), annotations: [] }] },
    ],
    usage: { input_tokens: 812, output_tokens: 96, total_tokens: 908 },
  };
  const prices = { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 };

  function provider(fetchImpl: typeof fetch, timeoutMs?: number) {
    return new OpenAiTutorProvider({ apiKey: "sk-test-not-a-real-key", model: "gpt-6-luna", prices, fetch: fetchImpl, timeoutMs });
  }

  it("sends instructions, messages and a strict JSON schema, and asks for nothing to be stored", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(completed));
    const result = await provider(fetchMock).generate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test-not-a-real-key");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      instructions: "be a tutor",
      input: [{ role: "user", content: "你好" }],
      store: false,
      text: { format: { type: "json_schema", name: "tutor_turn", strict: true } },
    });
    expect(body.text.format.schema).toEqual(TUTOR_OUTPUT_JSON_SCHEMA);
    expect(body.max_output_tokens).toBeGreaterThan(0);
    // The key travels only in the header.
    expect(String(init?.body)).not.toContain("sk-test");

    expect(parseTutorOutput(result.text)).toMatchObject({ ok: true });
    expect(result.usage).toEqual({ tokensIn: 812, tokensOut: 96 });
  });

  it("estimates cost from token counts and list prices", () => {
    const p = provider(vi.fn<typeof fetch>());
    expect(p.estimateUsd({ tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBeCloseTo(0.6, 10);
    expect(p.estimateUsd({ tokensIn: 812, tokensOut: 96 })).toBeCloseTo(0.0001292, 10);
    expect(p.paid).toBe(true);
    expect(p.mock).toBe(false);
  });

  it("treats a refusal, a cut-off answer and an empty answer as no usable output", () => {
    expect(readResponseText({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })).toBeNull();
    expect(readResponseText({ ...completed, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toBeNull();
    expect(readResponseText({ status: "completed", output: [] })).toBeNull();
    expect(readResponseText("nonsense")).toBeNull();
    expect(readResponseUsage({})).toEqual({ tokensIn: 0, tokensOut: 0 });
    expect(readResponseUsage({ usage: { input_tokens: -5, output_tokens: "many" } })).toEqual({ tokensIn: 0, tokensOut: 0 });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "http"],
  ])("maps HTTP %i to a category without the provider's message", async (status, kind) => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "secret detail sk-live-123" } }, { status }));
    const error = await provider(fetchMock).generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe(kind);
    expect((error as ProviderError).message).not.toContain("secret detail");
  });

  it("reports a network failure and a body that is not JSON", async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(provider(down).generate(request)).rejects.toMatchObject({ kind: "network" });
    const html = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 }));
    await expect(provider(html).generate(request)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("gives up after the timeout", async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(provider(hang, 20).generate(request)).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("choosing the tutor", () => {
  const db = {} as Env["DB"];

  it("uses the stand-in locally when no key is set, and it is free", () => {
    const tutor = selectTutorProvider({ DB: db, APP_ENV: "development" });
    expect(tutor).toBeInstanceOf(FakeTutorProvider);
    expect(tutor.mock).toBe(true);
    expect(tutor.paid).toBe(false);
    expect(tutor.estimateUsd({ tokensIn: 5000, tokensOut: 5000 })).toBe(0);
  });

  it("never uses the stand-in in production", () => {
    expect(() => selectTutorProvider({ DB: db, APP_ENV: "production" })).toThrowError(ApiError);
    expect(() => selectTutorProvider({ DB: db })).toThrowError(/not set up/);
  });

  it("uses OpenAI when a key is set, with the default model and its price", () => {
    const tutor = selectTutorProvider({ DB: db, APP_ENV: "production", OPENAI_API_KEY: "sk-test" });
    expect(tutor).toBeInstanceOf(OpenAiTutorProvider);
    expect(tutor.model).toBe("gpt-6-luna");
    expect(tutor.estimateUsd({ tokensIn: 1_000_000, tokensOut: 0 })).toBeCloseTo(0.1, 10);
  });

  it("refuses a model with no known price instead of running it untracked", () => {
    expect(() => selectTutorProvider({ DB: db, OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "some-new-model" })).toThrowError(/no price configured/);
  });

  it("takes price overrides only as a pair of sensible numbers", () => {
    expect(resolvePrices({ OPENAI_INPUT_USD_PER_MTOK: "2", OPENAI_OUTPUT_USD_PER_MTOK: "8" }, "some-new-model")).toEqual({ inputUsdPerMTok: 2, outputUsdPerMTok: 8 });
    expect(resolvePrices({ OPENAI_INPUT_USD_PER_MTOK: "2" }, "gpt-6-luna")).toBeNull();
    expect(resolvePrices({ OPENAI_INPUT_USD_PER_MTOK: "-1", OPENAI_OUTPUT_USD_PER_MTOK: "8" }, "gpt-6-luna")).toBeNull();
    expect(resolvePrices({ OPENAI_INPUT_USD_PER_MTOK: "cheap", OPENAI_OUTPUT_USD_PER_MTOK: "8" }, "gpt-6-luna")).toBeNull();
    expect(resolvePrices({}, "gpt-6-luna")).toEqual({ inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 });
  });
});

describe("usage month", () => {
  it("uses UTC calendar months", () => {
    expect(utcMonthBounds(new Date("2026-03-31T23:59:59.000Z"))).toEqual({ month: "2026-03", start: "2026-03-01T00:00:00.000Z", end: "2026-04-01T00:00:00.000Z" });
    expect(utcMonthBounds(new Date("2026-12-15T00:00:00.000Z")).end).toBe("2027-01-01T00:00:00.000Z");
  });
});
