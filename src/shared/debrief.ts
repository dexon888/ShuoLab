/**
 * Pausing, resuming and finishing a session, and the summary shown at the end
 * (SPEC §5.3 step 6, §9). The summary reports what happened in the session.
 * It makes no claim about what the learner now knows.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import { TARGET_ROLES, sessionDetailSchema } from "./session";
import { turnCorrectionSchema, turnSchema } from "./tutor";

export const SESSION_ACTIONS = ["pause", "resume", "abandon"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];

/** Body of PATCH /sessions/:id. */
export const sessionActionSchema = z.object({ action: z.enum(SESSION_ACTIONS) }).strict();
export type SessionActionRequest = z.infer<typeof sessionActionSchema>;

/** A gap between two actions counts toward practice time up to this many seconds. */
export const ACTIVITY_GAP_CAP_SECONDS = 180;
export const MAX_DEBRIEF_CORRECTIONS = 3;

export const debriefWordSchema = z.object({
  itemId: z.string(),
  hanzi: z.string(),
  pinyin: z.string().nullable(),
  hskBand: z.enum(HSK_BANDS),
  role: z.enum(TARGET_ROLES),
  /** The learner wrote or said this word in at least one turn. */
  usedByLearner: z.boolean(),
  /** The tutor used this word in at least one reply. */
  usedByTutor: z.boolean(),
});
export type DebriefWord = z.infer<typeof debriefWordSchema>;

export const debriefSchema = z.object({
  sessionId: z.string(),
  /** Time between the learner's actions, each gap capped. Not wall-clock time. */
  practiceSeconds: z.number().int().nonnegative(),
  plannedMinutes: z.number().int().positive(),
  turns: z.object({
    total: z.number().int().nonnegative(),
    /** Typed turns are writing practice. They are never counted as speaking. */
    typed: z.number().int().nonnegative(),
    spoken: z.number().int().nonnegative(),
    /** Turns where a prepared reply stood in for the tutor. */
    fallback: z.number().int().nonnegative(),
  }),
  /** The session's planned words and whether each came up. Exposure, not mastery. */
  words: z.array(debriefWordSchema),
  /** Ids of planned words the learner did not use: worth meeting again. */
  recommendedReviewItemIds: z.array(z.string()),
  /** At most three, the most recent first. */
  corrections: z.array(turnCorrectionSchema).max(MAX_DEBRIEF_CORRECTIONS),
});
export type Debrief = z.infer<typeof debriefSchema>;

/** GET /sessions/:id, PATCH /sessions/:id and POST /sessions/:id/complete all answer with this. */
export const sessionStateResponseSchema = z.object({
  session: sessionDetailSchema,
  /** The finished turns of the conversation, oldest first. */
  turns: z.array(turnSchema).default([]),
  /** Present once the session is complete. */
  debrief: debriefSchema.nullable().default(null),
});
export type SessionStateResponse = z.infer<typeof sessionStateResponseSchema>;
