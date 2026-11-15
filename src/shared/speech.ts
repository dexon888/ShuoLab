/**
 * Speech (SPEC §7). The browser talks to Azure AI Speech directly with a
 * short-lived token that the Worker issues; the resource key never leaves
 * the Worker. Audio never passes through ShuoLab and is never stored, so the
 * browser reports how much it used, and the Worker keeps the monthly count.
 */
import { z } from "zod";

/** Azure F0 free allowances, per month (Azure pricing page, read 2026-11-15). */
export const F0_RECOGNITION_SECONDS_PER_MONTH = 5 * 60 * 60;
export const F0_SYNTHESIS_CHARS_PER_MONTH = 500_000;

/** Push-to-talk: one utterance is at most this long. Azure's short-audio limit is 60 seconds. */
export const MAX_UTTERANCE_SECONDS = 60;
/** A tutor reply is at most 400 characters; allow headroom for a slower repeat. */
export const MAX_SYNTHESIS_CHARS_PER_EVENT = 2000;

/** Azure tokens last 10 minutes; Microsoft recommends reusing one for 9. */
export const SPEECH_TOKEN_REUSE_SECONDS = 9 * 60;

export const speechAllowanceSchema = z.object({
  /** UTC calendar month, YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  recognitionSeconds: z.number().nonnegative(),
  recognitionLimitSeconds: z.number().int().nonnegative(),
  synthesisChars: z.number().int().nonnegative(),
  synthesisLimitChars: z.number().int().nonnegative(),
  /** False once this month's recognition count reaches the limit: answer by typing. */
  recognitionAvailable: z.boolean(),
  /** False once this month's voice count reaches the limit: read the reply instead. */
  synthesisAvailable: z.boolean(),
});
export type SpeechAllowance = z.infer<typeof speechAllowanceSchema>;

/** POST /speech/token. The token is for Azure only; keep it in memory, never store it. */
export const speechTokenResponseSchema = z.object({
  token: z.string().min(1),
  region: z.string().min(1),
  /** Ask for a new token before this time. Earlier than Azure's own expiry. */
  expiresAt: z.string(),
  /** True for the local stand-in: the token does not work with Azure. */
  mock: z.boolean(),
  allowance: speechAllowanceSchema,
});
export type SpeechTokenResponse = z.infer<typeof speechTokenResponseSchema>;

/** POST /speech/usage: what one recognition or one spoken reply used. */
export const speechUsageRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      /** Made once per event; resending it is not counted twice. */
      clientEventId: z.uuid(),
      kind: z.literal("recognition"),
      audioSeconds: z.number().positive().max(MAX_UTTERANCE_SECONDS),
      sessionId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      clientEventId: z.uuid(),
      kind: z.literal("synthesis"),
      characters: z.number().int().positive().max(MAX_SYNTHESIS_CHARS_PER_EVENT),
      sessionId: z.uuid().optional(),
    })
    .strict(),
]);
export type SpeechUsageRequest = z.infer<typeof speechUsageRequestSchema>;

export const speechUsageResponseSchema = z.object({
  /** False when this clientEventId had already been counted. */
  recorded: z.boolean(),
  allowance: speechAllowanceSchema,
});
export type SpeechUsageResponse = z.infer<typeof speechUsageResponseSchema>;
