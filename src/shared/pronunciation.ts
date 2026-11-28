/**
 * Shadowing with pronunciation assessment (SPEC §7.3 promoted, Phase 7, FR-039).
 * Azure's scripted pronunciation assessment scores a learner reading a known
 * sentence: accuracy, fluency and completeness, and accuracy per character.
 * It is not a tone grade and never an HSK result; the learner's own recording
 * stays on the device and is never uploaded.
 */
import { z } from "zod";

export const assessedWordSchema = z.object({
  text: z.string(),
  accuracy: z.number().min(0).max(100),
  /** Azure's error type: None, Mispronunciation, Omission, Insertion. */
  error: z.string(),
});
export type AssessedWord = z.infer<typeof assessedWordSchema>;

export const assessmentScoresSchema = z.object({
  accuracy: z.number().min(0).max(100),
  fluency: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  pronunciation: z.number().min(0).max(100),
});
export type AssessmentScores = z.infer<typeof assessmentScoresSchema>;

/** Reads Azure's detailed JSON result; null when it carries no assessment. */
export function parseAssessment(json: string | null | undefined): { scores: AssessmentScores; words: AssessedWord[]; recognized: string } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      DisplayText?: string;
      NBest?: {
        Display?: string;
        PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; CompletenessScore?: number; PronScore?: number };
        Words?: { Word?: string; PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string } }[];
      }[];
    };
    const best = parsed.NBest?.[0];
    const pa = best?.PronunciationAssessment;
    if (!best || !pa) return null;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
    return {
      scores: { accuracy: n(pa.AccuracyScore), fluency: n(pa.FluencyScore), completeness: n(pa.CompletenessScore), pronunciation: n(pa.PronScore) },
      words: (best.Words ?? []).map((w) => ({ text: w.Word ?? "", accuracy: n(w.PronunciationAssessment?.AccuracyScore), error: w.PronunciationAssessment?.ErrorType ?? "None" })).filter((w) => w.text),
      recognized: best.Display ?? parsed.DisplayText ?? "",
    };
  } catch {
    return null;
  }
}

/** The weakest characters of an attempt, worst first, for replay and practice. */
export function weakest(words: readonly AssessedWord[], count = 3, below = 80): AssessedWord[] {
  return [...words].filter((w) => w.accuracy < below || w.error !== "None").sort((a, b) => a.accuracy - b.accuracy).slice(0, count);
}

// --- API ---------------------------------------------------------------------------

export const pronunciationAttemptRequestSchema = z
  .object({
    sessionId: z.uuid().nullable(),
    referenceText: z.string().trim().min(1).max(120),
    scores: assessmentScoresSchema,
    words: z.array(assessedWordSchema).max(60),
    audioSeconds: z.number().min(0).max(60),
  })
  .strict();
export type PronunciationAttemptRequest = z.infer<typeof pronunciationAttemptRequestSchema>;

export const pronunciationSummarySchema = z.object({
  attempts: z.number().int().nonnegative(),
  /** Mean scores over the window, or null with fewer than 5 attempts. */
  mean: assessmentScoresSchema.nullable(),
  /** Characters most often weak, with how often. */
  weakCharacters: z.array(z.object({ text: z.string(), times: z.number().int() })),
});
export type PronunciationSummary = z.infer<typeof pronunciationSummarySchema>;
