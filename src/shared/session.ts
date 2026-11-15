/**
 * Session plans (SPEC §2.4, §5.3, §6.2). A plan is built by a deterministic
 * planner from the imported curriculum before any model is involved, and is
 * stored with the session. Target ids in a plan are fixed for that session.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import { SESSION_MINUTE_OPTIONS, SESSION_STATUSES, SKILLS, type SessionMinutes } from "./learning";
import { turnSchema } from "./tutor";

export const SESSION_PLAN_VERSION = 1;

/** `hsk`: built on imported syllabus entries. `free_chat`: no syllabus, never HSK-labelled. */
export const SESSION_KINDS = ["hsk", "free_chat"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const ACTIVITY_KINDS = ["warmup", "listen", "speak", "read", "write", "summary"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** `active`: new at the study band. `review`: targeted before. `stretch`: one band up, never counted toward the band. */
export const TARGET_ROLES = ["active", "review", "stretch"] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

export const TARGET_ROLE_LABELS: Readonly<Record<TargetRole, string>> = {
  active: "New",
  review: "Review",
  stretch: "Stretch",
};

const minutesSchema = z.union(
  SESSION_MINUTE_OPTIONS.map((m) => z.literal(m)) as [z.ZodLiteral<15>, z.ZodLiteral<20>, z.ZodLiteral<25>, z.ZodLiteral<30>],
);

export const planActivitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  /** The skill this activity mainly exercises. */
  skill: z.enum(SKILLS),
  /** A guide, not a hard stop. */
  minutes: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
});
export type PlanActivity = z.infer<typeof planActivitySchema>;

export const planTargetSchema = z.object({
  /** Id of an imported curriculum item. Checked against the database when the plan is saved. */
  itemId: z.string(),
  sourceId: z.number().int().positive(),
  hskBand: z.enum(HSK_BANDS),
  hanzi: z.string(),
  pinyin: z.string().nullable(),
  role: z.enum(TARGET_ROLES),
});
export type PlanTarget = z.infer<typeof planTargetSchema>;

export const planSituationSchema = z.object({
  id: z.string(),
  /** Situations are written for ShuoLab. They are not HSK topics or tasks. */
  sourceType: z.literal("app-authored"),
  titleZh: z.string(),
  titleEn: z.string(),
  communicativeGoal: z.string(),
});
export type PlanSituation = z.infer<typeof planSituationSchema>;

export const sessionPlanSchema = z.object({
  version: z.literal(SESSION_PLAN_VERSION),
  kind: z.enum(SESSION_KINDS),
  /** Null for free chat. */
  editionId: z.string().nullable(),
  /** True when the edition is generated placeholder data, not HSK content. */
  synthetic: z.boolean(),
  targetBand: z.enum(HSK_BANDS).nullable(),
  /** `owner_choice`: picked by the owner. `suggestion`: no band chosen, HSK 1 suggested. Neither is a measured level. */
  bandSource: z.enum(["owner_choice", "suggestion"]).nullable(),
  durationMinutes: minutesSchema,
  localStudyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  situation: planSituationSchema,
  targets: z.array(planTargetSchema).max(8),
  /** Empty until a verified grammar list is imported. */
  grammarIds: z.array(z.string()),
  /** Colloquial expressions are listed apart from HSK targets and never counted as HSK. */
  colloquial: z
    .array(
      z.object({
        id: z.string(),
        term: z.string(),
        pinyin: z.string().nullable(),
        meaningEn: z.string(),
        warnings: z.array(z.string()),
        synthetic: z.boolean(),
      }),
    )
    .max(1),
  levelConstraints: z.object({
    activeBand: z.enum(HSK_BANDS).nullable(),
    stretchBand: z.enum(HSK_BANDS).nullable(),
  }),
  activities: z.array(planActivitySchema).min(1),
});
export type SessionPlan = z.infer<typeof sessionPlanSchema>;

// --- API ---------------------------------------------------------------------

/** Body of POST /sessions/plan. Everything is optional; settings fill the gaps. */
export const planRequestSchema = z
  .object({
    durationMinutes: minutesSchema,
    studyBand: z.enum(HSK_BANDS),
    /** Plan an open conversation with no syllabus targets. Never HSK-labelled. */
    freeChat: z.boolean(),
  })
  .partial()
  .strict();
export type PlanRequest = z.infer<typeof planRequestSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(SESSION_KINDS),
  status: z.enum(SESSION_STATUSES),
  localStudyDate: z.string(),
  durationMinutes: z.number().int().positive(),
  targetBand: z.enum(HSK_BANDS).nullable(),
  situationTitleEn: z.string(),
  situationTitleZh: z.string(),
  synthetic: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionDetailSchema = sessionSummarySchema.extend({
  editionId: z.string().nullable(),
  plan: sessionPlanSchema,
  actualSeconds: z.number().int().nonnegative(),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

export const planResponseSchema = z.object({
  session: sessionDetailSchema,
  /** True when today's unfinished session was returned instead of a new one. */
  reused: z.boolean(),
});
export type PlanResponse = z.infer<typeof planResponseSchema>;

export const sessionResponseSchema = z.object({
  session: sessionDetailSchema,
  /** The finished turns of the conversation, oldest first. */
  turns: z.array(turnSchema).default([]),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  /** Today's unfinished session, if any, for "resume". */
  resumable: sessionSummarySchema.nullable(),
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

// --- Time budget -------------------------------------------------------------

type Budget = Readonly<Record<ActivityKind, number>>;

/**
 * Minutes per activity for each session length. The 25-minute row follows the
 * SPEC target (5 listening, 12 speaking, 4 reading, 4 writing and review);
 * the others keep the same proportions. Listening plus speaking is about two
 * thirds of every session, and never under 40%.
 */
export const TIME_BUDGETS: Readonly<Record<SessionMinutes, Budget>> = {
  15: { warmup: 1, listen: 3, speak: 6, read: 2, write: 2, summary: 1 },
  20: { warmup: 1, listen: 4, speak: 9, read: 3, write: 2, summary: 1 },
  25: { warmup: 2, listen: 5, speak: 10, read: 4, write: 3, summary: 1 },
  30: { warmup: 2, listen: 6, speak: 12, read: 5, write: 4, summary: 1 },
};

/** How many syllabus entries a session of each length targets (SPEC: 3–8). */
export const TARGET_COUNTS: Readonly<Record<SessionMinutes, number>> = { 15: 4, 20: 5, 25: 6, 30: 8 };

/** Share of the session's minutes spent on listening and speaking. */
export function listeningSpeakingShare(activities: readonly PlanActivity[]): number {
  const total = activities.reduce((sum, a) => sum + a.minutes, 0);
  const oral = activities
    .filter((a) => a.skill === "listening" || a.skill === "speaking")
    .reduce((sum, a) => sum + a.minutes, 0);
  return total === 0 ? 0 : oral / total;
}

/** The owner's calendar date in their time zone, as YYYY-MM-DD. */
export function localStudyDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
