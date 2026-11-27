/**
 * Tutor turns (SPEC §6.3, §6.4, §9). Two contracts live here:
 *
 * - what the model must return (`tutorOutputSchema`), which is never trusted
 *   until it has been validated and its ids checked against the session; and
 * - what the API accepts and returns for a turn.
 */
import { z } from "zod";
import { SESSION_STATUSES } from "./learning";
import { speechAllowanceSchema } from "./speech";

export const SOURCE_MODES = ["speech", "typed"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

/** SEC-04: limits on what goes to and comes back from the tutor. */
export const MAX_TRANSCRIPT_CHARS = 4000;
export const MAX_REPLY_CHARS = 400;
export const MAX_TURNS_PER_SESSION = 80;
export const MAX_CORRECTIONS = 3;

// --- Model output contract -----------------------------------------------------

const correctionSchema = z
  .object({
    /** What the learner wrote or said. */
    original: z.string().min(1).max(200),
    /** A more natural or correct version. */
    corrected: z.string().min(1).max(200),
    note_en: z.string().max(300).nullable(),
  })
  .strict();

/**
 * The JSON the model is asked for. Field names follow SPEC §6.4. `strict`
 * means an extra field fails validation rather than being carried along.
 */
export const tutorOutputSchema = z
  .object({
    spoken_reply_zh: z.string().trim().min(1).max(MAX_REPLY_CHARS),
    optional_pinyin: z.string().max(1200).nullable(),
    optional_translation_en: z.string().max(800).nullable(),
    referenced_curriculum_item_ids: z.array(z.string().max(120)).max(12),
    referenced_colloquial_ids: z.array(z.string().max(160)).max(4),
    /** Grammar points of this session the reply uses (SPEC §6.3). Checked against the text. */
    used_grammar_ids: z.array(z.string().max(120)).max(4).default([]),
    /** Grammar points the reply invites the learner to use. Checked against the text. */
    elicited_grammar_ids: z.array(z.string().max(120)).max(4).default([]),
    semantic_feedback: z
      .object({
        understood_intent: z.boolean(),
        corrections: z.array(correctionSchema).max(MAX_CORRECTIONS),
        encouragement_zh: z.string().max(80).nullable(),
      })
      .strict(),
    suggested_followup_topic: z.string().max(80).nullable(),
  })
  .strict();
export type TutorOutput = z.infer<typeof tutorOutputSchema>;

/**
 * The same contract as JSON Schema, for providers that enforce a schema while
 * generating. Kept beside the Zod schema; a unit test checks they agree.
 */
export const TUTOR_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "spoken_reply_zh",
    "optional_pinyin",
    "optional_translation_en",
    "referenced_curriculum_item_ids",
    "referenced_colloquial_ids",
    "used_grammar_ids",
    "elicited_grammar_ids",
    "semantic_feedback",
    "suggested_followup_topic",
  ],
  properties: {
    spoken_reply_zh: { type: "string" },
    optional_pinyin: { type: ["string", "null"] },
    optional_translation_en: { type: ["string", "null"] },
    referenced_curriculum_item_ids: { type: "array", items: { type: "string" } },
    referenced_colloquial_ids: { type: "array", items: { type: "string" } },
    used_grammar_ids: { type: "array", items: { type: "string" } },
    elicited_grammar_ids: { type: "array", items: { type: "string" } },
    semantic_feedback: {
      type: "object",
      additionalProperties: false,
      required: ["understood_intent", "corrections", "encouragement_zh"],
      properties: {
        understood_intent: { type: "boolean" },
        corrections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["original", "corrected", "note_en"],
            properties: {
              original: { type: "string" },
              corrected: { type: "string" },
              note_en: { type: ["string", "null"] },
            },
          },
        },
        encouragement_zh: { type: ["string", "null"] },
      },
    },
    suggested_followup_topic: { type: ["string", "null"] },
  },
} as const;

const HAN = /\p{Script=Han}/gu;
const LATIN = /[A-Za-z]/g;

export function countHan(text: string): number {
  return text.match(HAN)?.length ?? 0;
}

/**
 * True when a reply is Mandarin rather than English. A reply may quote a
 * Latin word or name, so this asks for Chinese characters to be present and
 * to outnumber half of the Latin letters, not for Latin to be absent.
 */
export function isMandarinReply(text: string): boolean {
  const han = countHan(text);
  const latin = text.match(LATIN)?.length ?? 0;
  return han >= 2 && han * 2 >= latin;
}

// --- API -------------------------------------------------------------------------

/** Body of POST /sessions/:id/turn. */
export const turnRequestSchema = z
  .object({
    /** Made by the client once per message. Resending it never creates a second turn. */
    clientTurnId: z.uuid(),
    transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    sourceMode: z.enum(SOURCE_MODES),
    /** True when speech recognition was unsure. Never set for typed text. */
    asrUncertain: z.boolean().default(false),
  })
  .strict();
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export const turnCorrectionSchema = z.object({
  original: z.string(),
  corrected: z.string(),
  noteEn: z.string().nullable(),
});
export type TurnCorrection = z.infer<typeof turnCorrectionSchema>;

/** A saved turn: what the learner said and what the tutor answered. */
export const turnSchema = z.object({
  turnId: z.string(),
  clientTurnId: z.string(),
  position: z.number().int().nonnegative(),
  sourceMode: z.enum(SOURCE_MODES),
  learnerText: z.string(),
  reply: z.object({
    spokenZh: z.string(),
    pinyin: z.string().nullable(),
    translationEn: z.string().nullable(),
  }),
  /** Only ids of this session's targets whose word really appears in the reply. */
  referencedCurriculumItemIds: z.array(z.string()),
  /** Only ids of this session's colloquial expressions whose term appears in the reply. Never HSK. */
  referencedColloquialIds: z.array(z.string()),
  /** This session's grammar points whose pattern appears in the reply (SPEC §6.3). */
  grammarUsedIds: z.array(z.string()).default([]),
  /** This session's grammar points the reply invites the learner to use, with the pattern in the reply. */
  grammarElicitedIds: z.array(z.string()).default([]),
  /** This session's grammar points whose pattern appears in what the learner said or typed. */
  learnerGrammarIds: z.array(z.string()).default([]),
  /** Tokens of the reply the learner had met, of all tokens (SPEC §2.6 rule 4). Null for older turns. */
  coverage: z.object({ known: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).nullable().default(null),
  feedback: z.object({
    /** Null when there is no model feedback (a fallback reply). */
    understoodIntent: z.boolean().nullable(),
    corrections: z.array(turnCorrectionSchema),
    encouragementZh: z.string().nullable(),
    /** True when the transcript came from uncertain speech recognition: no corrections are given. */
    transcriptUncertain: z.boolean(),
  }),
  /** True when the tutor's answer could not be used and a prepared reply was shown instead. */
  fallback: z.boolean(),
  createdAt: z.string(),
  /**
   * Listening record for the reply (SPEC §10): when it was first heard and
   * when its text was first revealed. Heard before any reveal means it was
   * listened to without reading.
   */
  listening: z
    .object({ playedAt: z.string().nullable(), revealedAt: z.string().nullable() })
    .default({ playedAt: null, revealedAt: null }),
});
export type Turn = z.infer<typeof turnSchema>;

export const TURN_EVENTS = ["played", "revealed"] as const;
export type TurnEvent = (typeof TURN_EVENTS)[number];

/** Body of POST /sessions/:id/turns/:turnId/events. Only the first of each is kept. */
export const turnEventRequestSchema = z.object({ event: z.enum(TURN_EVENTS) }).strict();

export const turnEventResponseSchema = z.object({
  turnId: z.string(),
  listening: z.object({ playedAt: z.string().nullable(), revealedAt: z.string().nullable() }),
});
export type TurnEventResponse = z.infer<typeof turnEventResponseSchema>;

export const turnUsageSchema = z.object({
  /** Estimate for this turn, including a retry. Zero when replayed or when the local stand-in answered. */
  estimatedUsdThisTurn: z.number().nonnegative(),
  monthEstimatedUsd: z.number().nonnegative(),
  /** True when this month's estimate has reached the warning amount in Settings. */
  softLimitReached: z.boolean(),
});

export const turnResponseSchema = z.object({
  sessionId: z.string(),
  sessionStatus: z.enum(SESSION_STATUSES),
  turn: turnSchema,
  /** True when this clientTurnId was already answered and the saved turn was returned. */
  replayed: z.boolean(),
  provider: z.object({
    vendor: z.string(),
    model: z.string(),
    /** True for the local stand-in tutor: no model was called. */
    mock: z.boolean(),
  }),
  usage: turnUsageSchema,
});
export type TurnResponse = z.infer<typeof turnResponseSchema>;

/** GET /usage/monthly. All amounts are this app's estimates, not a provider bill. */
export const monthlyUsageResponseSchema = z.object({
  /** UTC calendar month, YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  estimatedUsd: z.number().nonnegative(),
  softUsd: z.number().nonnegative(),
  hardUsd: z.number().nonnegative(),
  remainingUsd: z.number().nonnegative(),
  softLimitReached: z.boolean(),
  hardLimitReached: z.boolean(),
  tutor: z.object({
    requests: z.number().int().nonnegative(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    estimatedUsd: z.number().nonnegative(),
  }),
  /** Azure free-tier use this month. Counted from what the browser reports. */
  speech: speechAllowanceSchema,
  disclaimer: z.string(),
});
export type MonthlyUsageResponse = z.infer<typeof monthlyUsageResponseSchema>;

export const USAGE_DISCLAIMER =
  "An estimate from this app's own count of tokens. Your provider's bill may differ, and this is not a cap at the provider.";
