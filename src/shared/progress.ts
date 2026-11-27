/**
 * Progress summary (SPEC §5.2, §5.6, §6.5). Every figure carries its sample
 * size; a rate drawn from fewer than MIN_OBSERVATIONS observations is null
 * and shown as insufficient evidence. HSK coverage and communication are
 * reported separately, and neither is an HSK exam score.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import { SKILLS } from "./learning";

export const MIN_OBSERVATIONS = 5;
export const PROGRESS_WINDOWS = [7, 30, 90] as const;
export type ProgressWindow = (typeof PROGRESS_WINDOWS)[number];

export const progressQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((d): d is ProgressWindow => (PROGRESS_WINDOWS as readonly number[]).includes(d), { message: "days is 7, 30 or 90" })
    .default(30),
});

/** A rate, or null below the minimum sample. */
export function rateOrNull(part: number, whole: number): number | null {
  return whole >= MIN_OBSERVATIONS ? part / whole : null;
}

const count = z.number().int().nonnegative();

/** Counts of entries at each evidence state for one skill. Unseen is the rest of the denominator. */
const skillCountsSchema = z.object({
  introduced: count,
  practiced: count,
  developing: count,
  mastered: count,
});
export type SkillCounts = z.infer<typeof skillCountsSchema>;

const coverageRowSchema = z.object({
  /** Imported entries: the denominator. */
  entries: count,
  /** Entries with any evidence state beyond unseen, in any skill. */
  introduced: count,
  bySkill: z.object(Object.fromEntries(SKILLS.map((s) => [s, skillCountsSchema])) as Record<(typeof SKILLS)[number], typeof skillCountsSchema>),
});

const sectionCoverageSchema = z.object({
  /** True when the section comes from an unverified source (SPEC §2.5 rule 2). */
  unverified: z.boolean(),
  /** `entries` is the imported count for the band: there are no published totals to compare. */
  bands: z.array(coverageRowSchema.extend({ band: z.enum(HSK_BANDS) })),
  total: coverageRowSchema,
});
export type SectionCoverage = z.infer<typeof sectionCoverageSchema>;

const exposureSchema = z.object({
  /** Distinct items used by a finished session: exposure, never mastery. */
  met: count,
  imported: count,
  /** Tasks only: achieved by the task check (SPEC §6.1). */
  achieved: count.default(0),
});

export const progressSummarySchema = z.object({
  generatedAt: z.string(),
  timeZone: z.string(),
  window: z.object({ days: z.number().int().positive(), from: z.string(), to: z.string() }),
  practice: z.object({
    /** Every day in the window, oldest first, in the owner's time zone. */
    days: z.array(z.object({ date: z.string(), minutes: z.number().nonnegative() })),
    totalMinutes: z.number().nonnegative(),
    /** Days in the window with any practice. */
    activeDays: count,
    sessionsCompleted: count,
  }),
  listening: z.object({
    /** Exercises answered before their text was shown: the only ones that count. */
    checks: count,
    questions: count,
    correct: count,
    /** Correct ÷ questions, or null with fewer than MIN_OBSERVATIONS checks. */
    accuracy: z.number().min(0).max(1).nullable(),
    /** Answered after seeing the text: shown, not counted. */
    assistedChecks: count,
    lastCheckedAt: z.string().nullable(),
  }),
  speaking: z.object({
    spokenTurns: count,
    typedTurns: count,
    sessionsWithSpeech: count,
  }),
  reviews: z.object({
    ratings: count,
    recalled: count,
    /** Recalled ÷ ratings, or null with fewer than MIN_OBSERVATIONS ratings. */
    recallRate: z.number().min(0).max(1).nullable(),
    /** Mean self-rating, 1 (Again) to 4 (Easy), or null below the minimum. */
    averageRating: z.number().min(1).max(4).nullable(),
  }),
  hsk: z.object({
    editionId: z.string().nullable(),
    synthetic: z.boolean(),
    bands: z.array(coverageRowSchema.extend({ band: z.enum(HSK_BANDS), expectedEntries: z.number().int().positive() })),
    total: coverageRowSchema,
  }),
  /** Grammar and characters, kept apart from verified vocabulary coverage (SPEC §2.5, §8.3). */
  sections: z
    .object({
      grammar: sectionCoverageSchema.nullable(),
      character: sectionCoverageSchema.nullable(),
      topics: exposureSchema,
      tasks: exposureSchema,
    })
    .default({ grammar: null, character: null, topics: { met: 0, imported: 0, achieved: 0 }, tasks: { met: 0, imported: 0, achieved: 0 } }),
  /** Attempts and successes per skill in the window (SPEC §8.3 skill balance). */
  skillBalance: z.array(z.object({ skill: z.enum(SKILLS), attempts: count, successes: count })).default([]),
  /**
   * Days in the window with at least one production attempt (spoken or written)
   * and at least one retrieval (a review rating): SPEC §8.3, in place of a streak.
   */
  meaningfulDays: z.object({ count, dates: z.array(z.string()) }).default({ count: 0, dates: [] }),
});
export type ProgressSummary = z.infer<typeof progressSummarySchema>;
