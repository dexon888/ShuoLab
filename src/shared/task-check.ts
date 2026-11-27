/**
 * Task checks (SPEC §6.1, FR-030) and flags on unverified rows (SPEC §2.5
 * rule 8, FR-031).
 *
 * A task check has 2–3 yes/no criteria taken from the task's can-do
 * statement, judged against what the learner said and wrote in one session.
 * A criterion counts as met only when the judge quotes the learner's own
 * words and those words really are in what they said or wrote. A task is
 * achieved after passing on two different days, in at least two topics. It
 * is a personal can-do check, never an HSK task result.
 */
import { z } from "zod";

export const TASK_CHECK_FORMAT_NAME = "task_check";
/** Bumped whenever the judging instructions or rules change. */
export const TASK_CHECK_SCORER_VERSION = "task-check-v1";
export const TASK_ACHIEVED_PASSES = 2;

export const taskCheckOutputSchema = z
  .object({
    criteria: z
      .array(
        z
          .object({
            label_en: z.string().trim().min(1).max(160),
            met: z.boolean(),
            /** The learner's own words that show it, copied exactly; empty when not met. */
            evidence_quote: z.string().max(200),
          })
          .strict(),
      )
      .min(2)
      .max(3),
  })
  .strict();
export type TaskCheckOutput = z.infer<typeof taskCheckOutputSchema>;

export const TASK_CHECK_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criteria"],
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label_en", "met", "evidence_quote"],
        properties: { label_en: { type: "string" }, met: { type: "boolean" }, evidence_quote: { type: "string" } },
      },
    },
  },
} as const;

export const taskCheckCriterionSchema = z.object({
  label: z.string(),
  met: z.boolean(),
  /** The learner's words that show it; null when not met. */
  evidence: z.string().nullable(),
});

export const taskCheckSchema = z.object({
  sessionId: z.string(),
  taskItemId: z.string(),
  canDo: z.string(),
  criteria: z.array(taskCheckCriterionSchema),
  passed: z.boolean(),
  scorerModel: z.string(),
  scorerVersion: z.string(),
  /** True when the local stand-in judged it: practice data, not a real check. */
  standIn: z.boolean(),
  checkedAt: z.string(),
  /** Passes of this task so far, on different days, and whether it is now achieved. */
  task: z.object({ passes: z.number().int().nonnegative(), topics: z.number().int().nonnegative(), achieved: z.boolean() }),
});
export type TaskCheck = z.infer<typeof taskCheckSchema>;

export const taskCheckResponseSchema = z.object({ check: taskCheckSchema.nullable() });

// --- Flags --------------------------------------------------------------------------

export const flagRequestSchema = z.object({ note: z.string().trim().max(300).optional() }).strict();
export const itemFlagSchema = z.object({ itemId: z.string(), note: z.string().nullable(), flaggedAt: z.string() });
export type ItemFlag = z.infer<typeof itemFlagSchema>;
export const flagResponseSchema = z.object({ flag: itemFlagSchema.nullable() });
export const flagListResponseSchema = z.object({
  flags: z.array(itemFlagSchema.extend({ hanzi: z.string(), itemType: z.string(), hskBand: z.string() })),
});
