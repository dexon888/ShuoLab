/**
 * Band practice tests and monthly checkpoints (SPEC §6.5, FR-027, FR-022).
 *
 * Questions are built in code from imported items, with their keys, never
 * written by a model. Scores are personal tracking: never an HSK score or
 * pass. Keys built from an unverified source are labelled as such.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import { SKILLS } from "./learning";

export const ASSESSMENT_KINDS = ["band_test", "checkpoint", "placement"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];
export const RUBRIC_VERSION = "band-test-v1";

export const QUESTION_KINDS = ["word_reading", "word_listening", "grammar_gap", "character_word", "writing_task", "speaking_task"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** How many of each a test asks. Fewer when a band has too few items. */
export const TEST_SIZES: Readonly<Record<QuestionKind, number>> = {
  word_reading: 5,
  word_listening: 5,
  grammar_gap: 4,
  character_word: 4,
  writing_task: 1,
  speaking_task: 0,
};
/** Placement asks this many words from every band (SPEC §2.6 rule 6). */
export const PLACEMENT_PER_BAND = 6;
/** A band counts as known in placement at this share, after correcting for guessing. */
export const PLACEMENT_KNOWN = 0.8;
/** Promotion: this share of the band's words recalled in reading, and this many passed band tests. */
export const PROMOTION_RECALLED = 0.8;
export const PROMOTION_TEST_SCORE = 0.8;
export const PROMOTION_TEST_PASSES = 2;

/** A checkpoint adds one spontaneous speaking task (SPEC §6.5). */
export const CHECKPOINT_SIZES: Readonly<Record<QuestionKind, number>> = { ...TEST_SIZES, speaking_task: 1 };

export const SECTION_SKILL: Readonly<Record<QuestionKind, (typeof SKILLS)[number]>> = {
  word_reading: "reading",
  word_listening: "listening",
  grammar_gap: "reading",
  character_word: "reading",
  writing_task: "writing",
  speaking_task: "speaking",
};

/** A question as the learner sees it: no key. */
export const testQuestionSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(QUESTION_KINDS),
  /** What to do, in English. */
  ask: z.string(),
  /** Text shown with the question: a word, a sentence with a gap, a character. Null for audio-only. */
  prompt: z.string().nullable(),
  /** Text the device reads aloud for a listening question. */
  audio: z.string().nullable(),
  /** Choices; empty for a written or spoken answer. */
  options: z.array(z.string()),
  /** For written and spoken tasks: what counts. */
  criteria: z.array(z.string()),
  /** True when the key comes from an unverified source (SPEC §2.5). */
  unverifiedKey: z.boolean(),
});
export type TestQuestion = z.infer<typeof testQuestionSchema>;

export const sectionScoreSchema = z.object({
  kind: z.enum(QUESTION_KINDS),
  skill: z.enum(SKILLS),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const questionResultSchema = z.object({
  index: z.number().int().nonnegative(),
  correct: z.boolean(),
  /** The right option or what counted, shown after finishing. */
  key: z.string(),
  answer: z.string().nullable(),
});

export const assessmentSchema = z.object({
  id: z.string(),
  kind: z.enum(ASSESSMENT_KINDS),
  hskBand: z.enum(HSK_BANDS),
  editionId: z.string(),
  synthetic: z.boolean(),
  rubricVersion: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** A topic and task of the band that frame the writing and speaking tasks. */
  frame: z.object({ topic: z.string().nullable(), task: z.string().nullable() }),
  questions: z.array(testQuestionSchema),
  results: z
    .object({
      sections: z.array(sectionScoreSchema),
      questions: z.array(questionResultSchema),
      correct: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      /** Placement only: per band, the share known after correcting for guessing, a size estimate, and a suggestion. */
      placement: z
        .object({
          bands: z.array(z.object({ band: z.enum(HSK_BANDS), correct: z.number().int(), total: z.number().int(), known: z.number().min(0).max(1), bandSize: z.number().int() })),
          estimatedWords: z.number().int().nonnegative(),
          sampleSize: z.number().int().nonnegative(),
          suggestedBand: z.enum(HSK_BANDS),
        })
        .nullable()
        .default(null),
    })
    .nullable(),
});
export type Assessment = z.infer<typeof assessmentSchema>;

/** SPEC §2.6 rule 6: is the study band done enough to suggest the next? */
export const promotionSchema = z.object({
  band: z.enum(HSK_BANDS),
  next: z.enum(HSK_BANDS).nullable(),
  bandSize: z.number().int(),
  /** Words of the band recalled in reading (developing or mastered). */
  recalled: z.number().int(),
  /** Finished band tests of this band at or above the pass score. */
  testPasses: z.number().int(),
  ready: z.boolean(),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const assessmentResponseSchema = z.object({ assessment: assessmentSchema });
export const assessmentListResponseSchema = z.object({
  runs: z.array(assessmentSchema.omit({ questions: true })),
  /** True when this calendar month has no checkpoint yet. */
  checkpointDue: z.boolean(),
});

export const startTestRequestSchema = z.object({ band: z.enum(HSK_BANDS), kind: z.enum(ASSESSMENT_KINDS).default("band_test") }).strict();
export const answerTestRequestSchema = z
  .object({
    /** One answer per question, in order: an option index, or text for a written or spoken task. */
    answers: z.array(z.union([z.number().int().min(0).max(5), z.string().trim().max(1000), z.null()])).max(60),
    /** How each spoken task was answered; typed answers are not speaking evidence. */
    spoken: z.array(z.boolean()).max(60).default([]),
  })
  .strict();
