/**
 * The "Listen first" exercise (SPEC §5.3 step 2, §6.5, §10): a short exchange
 * heard before any text is shown, with comprehension questions answered
 * before the transcript is revealed. One per session.
 *
 * Two contracts live here: what the model must return, and what the API
 * accepts and returns.
 */
import { z } from "zod";
import { isMandarinReply } from "./tutor";

export const LISTENING_FORMAT_NAME = "listening_exercise";
export const LISTENING_SPEAKERS = ["A", "B"] as const;
export const MIN_LISTENING_LINES = 2;
export const MAX_LISTENING_LINES = 8;
export const MIN_LISTENING_QUESTIONS = 2;
export const MAX_LISTENING_QUESTIONS = 3;
export const LISTENING_OPTIONS = 3;
/** "Play slower" multiplies the Settings speech rate by this. */
export const SLOWER_RATE_FACTOR = 0.8;

// --- Model output contract -----------------------------------------------------

const outputLineSchema = z
  .object({
    speaker: z.enum(LISTENING_SPEAKERS),
    zh: z.string().trim().min(1).max(120),
    pinyin: z.string().trim().min(1).max(400),
    en: z.string().trim().min(1).max(300),
  })
  .strict();

const outputQuestionSchema = z
  .object({
    question_en: z.string().trim().min(1).max(200),
    options_en: z.array(z.string().trim().min(1).max(120)).length(LISTENING_OPTIONS),
    answer_index: z.number().int().min(0).max(LISTENING_OPTIONS - 1),
  })
  .strict();

export const listeningOutputSchema = z
  .object({
    lines: z.array(outputLineSchema).min(MIN_LISTENING_LINES).max(MAX_LISTENING_LINES),
    questions: z.array(outputQuestionSchema).min(MIN_LISTENING_QUESTIONS).max(MAX_LISTENING_QUESTIONS),
  })
  .strict()
  .refine((o) => o.lines.every((l) => isMandarinReply(l.zh)), { message: "Every line must be in Mandarin." })
  .refine((o) => o.questions.every((q) => new Set(q.options_en.map((x) => x.toLowerCase())).size === q.options_en.length), {
    message: "Options must differ.",
  });
export type ListeningOutput = z.infer<typeof listeningOutputSchema>;

/** The same contract as JSON Schema, for providers that enforce a schema while generating. */
export const LISTENING_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines", "questions"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "zh", "pinyin", "en"],
        properties: {
          speaker: { type: "string", enum: [...LISTENING_SPEAKERS] },
          zh: { type: "string" },
          pinyin: { type: "string" },
          en: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_en", "options_en", "answer_index"],
        properties: {
          question_en: { type: "string" },
          options_en: { type: "array", items: { type: "string" } },
          answer_index: { type: "integer" },
        },
      },
    },
  },
} as const;

// --- API -------------------------------------------------------------------------

export const listeningLineSchema = z.object({
  speaker: z.enum(LISTENING_SPEAKERS),
  zh: z.string(),
  pinyin: z.string(),
  en: z.string(),
});
export type ListeningLine = z.infer<typeof listeningLineSchema>;

export const listeningQuestionSchema = z.object({
  questionEn: z.string(),
  optionsEn: z.array(z.string()),
  /** Withheld until the questions are answered or skipped. */
  answerIndex: z.number().int().nonnegative().nullable(),
});
export type ListeningQuestion = z.infer<typeof listeningQuestionSchema>;

export const listeningResultSchema = z.object({
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /**
   * True when the answers were given before the text was shown. Only an
   * unassisted result is evidence of listening (SPEC §6.5, §10).
   */
  unassisted: z.boolean(),
});
export type ListeningResult = z.infer<typeof listeningResultSchema>;

export const listeningExerciseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  /** `generated`: written by the tutor model for this session. `prepared`: written for ShuoLab, used when generation failed. */
  source: z.enum(["generated", "prepared"]),
  /** The model that wrote it, or the local stand-in. Null for a prepared exchange. */
  model: z.string().nullable(),
  /** True when the local stand-in wrote it: practice data, not a real exchange. */
  standIn: z.boolean(),
  lines: z.array(listeningLineSchema),
  questions: z.array(listeningQuestionSchema),
  createdAt: z.string(),
  playedAt: z.string().nullable(),
  revealedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  /** The chosen option for each question; null for a skipped question set. */
  answers: z.array(z.number().int().nonnegative()).nullable(),
  result: listeningResultSchema.nullable(),
});
export type ListeningExercise = z.infer<typeof listeningExerciseSchema>;

export const LISTENING_EVENTS = ["played", "revealed"] as const;
export type ListeningEvent = (typeof LISTENING_EVENTS)[number];

/** Body of POST /sessions/:id/listening/events. Only the first of each is kept. */
export const listeningEventRequestSchema = z.object({ event: z.enum(LISTENING_EVENTS) }).strict();

/** Body of POST /sessions/:id/listening/answers. The first answers sent are kept. */
export const listeningAnswersRequestSchema = z
  .object({ answers: z.array(z.number().int().min(0).max(LISTENING_OPTIONS - 1)).min(1).max(MAX_LISTENING_QUESTIONS) })
  .strict();

export const listeningResponseSchema = z.object({
  exercise: listeningExerciseSchema,
  /** True when the session already had an exercise and it was returned. */
  existing: z.boolean().default(false),
});
export type ListeningResponse = z.infer<typeof listeningResponseSchema>;
