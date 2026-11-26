/**
 * Review cards, ratings and mastery (SPEC §5.5, §6.1, §8.2).
 *
 * Exposure is not ability. A word becomes `introduced` when a finished
 * session targeted it; only rated recall attempts move it further, and
 * separately for each skill. The mastery rule is this app's heuristic, not
 * an HSK requirement.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import { MASTERY_STATES, SKILLS, type MasteryState, type Skill } from "./learning";
import { localStudyDate } from "./session";

export const REVIEW_RATINGS = ["again", "hard", "good", "easy"] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/**
 * Card templates. Each exercises one skill:
 * - `hanzi_to_meaning` (reading): see the characters, recall sound and meaning;
 * - `audio_to_meaning` (listening): hear the word, recall what it is.
 */
export const REVIEW_TEMPLATES = ["hanzi_to_meaning", "audio_to_meaning"] as const;
export type ReviewTemplate = (typeof REVIEW_TEMPLATES)[number];

export const TEMPLATE_SKILL: Readonly<Record<ReviewTemplate, Skill>> = {
  hanzi_to_meaning: "reading",
  audio_to_meaning: "listening",
};

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
