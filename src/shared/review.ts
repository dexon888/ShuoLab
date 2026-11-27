/**
 * Review cards, ratings and mastery (SPEC §5.5, §6.1, §8.2).
 *
 * Exposure is not ability. A word becomes `introduced` when a finished
 * session targeted it; only rated recall attempts move it further, and
 * separately for each skill. The mastery rule is this app's heuristic, not
 * an HSK requirement.
 */
import { z } from "zod";
import { HSK_BANDS, ITEM_TYPES } from "./curriculum";
import { itemDetailsSchema } from "./sections";
import { MASTERY_STATES, SKILLS, type MasteryState, type Skill } from "./learning";
import { localStudyDate } from "./session";

export const REVIEW_RATINGS = ["again", "hard", "good", "easy"] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/**
 * Card templates (SPEC §5.5). Each exercises one skill. Reading and listening
 * cards are recognition; speaking and writing cards are production, and only
 * production evidence moves the speaking and writing skills.
 *
 * Words:      hanzi_to_meaning (reading), audio_to_meaning (listening),
 *             word_say (speaking: use it aloud), word_write (writing: type it from its sound).
 * Grammar:    grammar_read (reading: understand a syllabus example),
 *             grammar_listen (listening: hear the example),
 *             grammar_say (speaking: say a sentence with the pattern),
 *             grammar_write (writing: type a sentence with the pattern).
 * Characters: char_recognise (reading: shown inside words you know),
 *             char_type (writing, typed: produce it from a word's pinyin).
 */
export const REVIEW_TEMPLATES = [
  "hanzi_to_meaning",
  "audio_to_meaning",
  "word_say",
  "word_write",
  "grammar_read",
  "grammar_listen",
  "grammar_say",
  "grammar_write",
  "char_recognise",
  "char_type",
] as const;
export type ReviewTemplate = (typeof REVIEW_TEMPLATES)[number];

export const TEMPLATE_SKILL: Readonly<Record<ReviewTemplate, Skill>> = {
  hanzi_to_meaning: "reading",
  audio_to_meaning: "listening",
  word_say: "speaking",
  word_write: "writing",
  grammar_read: "reading",
  grammar_listen: "listening",
  grammar_say: "speaking",
  grammar_write: "writing",
  char_recognise: "reading",
  char_type: "writing",
};

/** Templates made when a word is first met; its production cards follow its first recall (SPEC §5.5). */
export const WORD_RECOGNITION_TEMPLATES = ["hanzi_to_meaning", "audio_to_meaning"] as const;
export const WORD_PRODUCTION_TEMPLATES = ["word_say", "word_write"] as const;
export const GRAMMAR_TEMPLATES = ["grammar_read", "grammar_listen", "grammar_say", "grammar_write"] as const;

export function isProduction(template: ReviewTemplate): boolean {
  const skill = TEMPLATE_SKILL[template];
  return skill === "speaking" || skill === "writing";
}

export const CARD_STATES = ["new", "learning", "review", "relearning"] as const;
export type CardState = (typeof CARD_STATES)[number];

export const MAX_DUE_CARDS = 50;

// --- Mastery -------------------------------------------------------------------

export interface MasteryRules {
  /** Successful recalls needed, each on a different day. */
  minSuccessDays: number;
  /** At least one success this many hours after the word was introduced. */
  delayHours: number;
}

export const DEFAULT_MASTERY_RULES: MasteryRules = { minSuccessDays: 3, delayHours: 24 };

export interface RecallEvidence {
  attemptedAt: string;
  success: boolean;
}

export interface MasteryInput {
  /** When a finished session first targeted the word; null if it never did. */
  introducedAt: string | null;
  /** Qualifying recall attempts for one item and one skill, in any order. */
  attempts: readonly RecallEvidence[];
  /** The owner's time zone: "different days" are the owner's calendar days. */
  timeZone: string;
  rules?: MasteryRules;
}

export interface MasterySummary {
  state: MasteryState;
  firstSeenAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  successDays: number;
  failureCount: number;
}

/**
 * SPEC §6.1, derived only from evidence, never stored on its own say-so:
 * - `unseen`: never introduced and never attempted;
 * - `introduced`: targeted in a finished session, no attempt yet;
 * - `practiced`: attempted, never recalled;
 * - `developing`: recalled at least once, but not yet enough;
 * - `mastered`: recalled on enough different days, at least once after the
 *   delay, and the latest attempt succeeded. A failed recall drops a
 *   mastered word back to developing; the history itself is kept.
 */
export function deriveMastery(input: MasteryInput): MasterySummary {
  const rules = input.rules ?? DEFAULT_MASTERY_RULES;
  const attempts = [...input.attempts].sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
  const successes = attempts.filter((a) => a.success);
  const firstSeenAt = input.introducedAt ?? attempts[0]?.attemptedAt ?? null;
  const summary = {
    firstSeenAt,
    lastAttemptAt: attempts.at(-1)?.attemptedAt ?? null,
    lastSuccessAt: successes.at(-1)?.attemptedAt ?? null,
    successDays: new Set(successes.map((a) => localStudyDate(new Date(a.attemptedAt), input.timeZone))).size,
    failureCount: attempts.length - successes.length,
  };

  if (attempts.length === 0) return { ...summary, state: input.introducedAt ? "introduced" : "unseen" };
  if (successes.length === 0) return { ...summary, state: "practiced" };

  const delayMs = rules.delayHours * 3_600_000;
  const start = firstSeenAt ? Date.parse(firstSeenAt) : Number.POSITIVE_INFINITY;
  const delayed = successes.some((a) => Date.parse(a.attemptedAt) - start >= delayMs);
  const latestOk = attempts.at(-1)?.success === true;
  const mastered = summary.successDays >= rules.minSuccessDays && delayed && latestOk;
  return { ...summary, state: mastered ? "mastered" : "developing" };
}

// --- API -------------------------------------------------------------------------

const isoSchema = z.string();

export const reviewCardSchema = z.object({
  id: z.string(),
  template: z.enum(REVIEW_TEMPLATES),
  skill: z.enum(SKILLS),
  item: z.object({
    id: z.string(),
    editionId: z.string(),
    /** True for generated placeholder data, which is not HSK content. */
    synthetic: z.boolean(),
    hskBand: z.enum(HSK_BANDS),
    hanzi: z.string(),
    pinyin: z.string().nullable(),
    /** Only a definition with a recorded source; the syllabus itself has none. */
    definition: z.string().nullable(),
    definitionProvenance: z.string().nullable(),
    itemType: z.enum(ITEM_TYPES).default("vocab"),
    /** Grammar and character details, labelled unverified where they are. */
    details: itemDetailsSchema.nullable().default(null),
    /** For a grammar point: one syllabus example showing its pattern. */
    example: z.string().nullable().default(null),
    /** For a character: up to three words you have met that contain it. */
    words: z.array(z.object({ hanzi: z.string(), pinyin: z.string().nullable() })).default([]),
    /** True when the item comes from an unverified source (SPEC §2.5). */
    unverified: z.boolean().default(false),
  }),
  state: z.enum(CARD_STATES),
  dueAt: isoSchema,
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  /** When the card would next be due after each rating, if rated now. */
  preview: z.object({ again: isoSchema, hard: isoSchema, good: isoSchema, easy: isoSchema }),
  /** This skill's mastery for the word, from all evidence so far. */
  mastery: z.enum(MASTERY_STATES),
});
export type ReviewCard = z.infer<typeof reviewCardSchema>;

export const dueQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(MAX_DUE_CARDS).default(20) });

export const dueResponseSchema = z.object({
  cards: z.array(reviewCardSchema),
  /** All cards due now, which may be more than were returned. */
  dueCount: z.number().int().nonnegative(),
  totalCards: z.number().int().nonnegative(),
  /** The earliest due time after now, when nothing is due. */
  nextDueAt: isoSchema.nullable(),
});
export type DueResponse = z.infer<typeof dueResponseSchema>;

/** Body of POST /reviews/:id/rate. Sending the same clientEventId again changes nothing. */
export const rateRequestSchema = z
  .object({
    rating: z.enum(REVIEW_RATINGS),
    clientEventId: z.uuid(),
    /** What was typed on a writing card, kept with the rating. */
    answer: z.string().trim().max(300).optional(),
  })
  .strict();
export type RateRequest = z.infer<typeof rateRequestSchema>;

export const rateResponseSchema = z.object({
  cardId: z.string(),
  rating: z.enum(REVIEW_RATINGS),
  nextDueAt: isoSchema,
  state: z.enum(CARD_STATES),
  mastery: z.enum(MASTERY_STATES),
  /** True when this clientEventId was already recorded and its result returned. */
  replayed: z.boolean(),
});
export type RateResponse = z.infer<typeof rateResponseSchema>;
