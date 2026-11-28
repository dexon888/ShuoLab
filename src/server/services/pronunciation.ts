import type { D1Database } from "@cloudflare/workers-types";
import type { AssessedWord, PronunciationAttemptRequest, PronunciationSummary } from "../../shared/pronunciation";
import { ApiError } from "../validation/errors";

/** Attempts the summary looks back over. */
export const SUMMARY_WINDOW = 30;
/** Fewer attempts than this give no mean: one sentence says little. */
export const SUMMARY_MIN = 5;
/** A character below this accuracy counts as weak. */
export const WEAK_BELOW = 60;

export async function recordAttempt(d1: D1Database, body: PronunciationAttemptRequest, now: Date = new Date()): Promise<{ id: string }> {
  if (body.sessionId) {
    const exists = await d1.prepare("SELECT 1 FROM sessions WHERE id = ?1").bind(body.sessionId).first();
    if (!exists) throw new ApiError("NOT_FOUND", "No such session.");
  }
  const id = crypto.randomUUID();
  const { accuracy, fluency, completeness, pronunciation } = body.scores;
  await d1
    .prepare(
      "INSERT INTO pronunciation_attempts (id, session_id, reference_text, accuracy, fluency, completeness, pronunciation, words_json, audio_seconds, attempted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )
    .bind(id, body.sessionId, body.referenceText, accuracy, fluency, completeness, pronunciation, JSON.stringify(body.words), body.audioSeconds, now.toISOString())
    .run();
  return { id };
}

/** The recent trend: mean scores and the characters most often weak. */
export async function pronunciationSummary(d1: D1Database): Promise<PronunciationSummary> {
  const total = (await d1.prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").first<{ n: number }>())?.n ?? 0;
  const rows = (
    await d1
      .prepare("SELECT accuracy, fluency, completeness, pronunciation, words_json FROM pronunciation_attempts ORDER BY attempted_at DESC, id DESC LIMIT ?1")
      .bind(SUMMARY_WINDOW)
      .all<{ accuracy: number; fluency: number; completeness: number; pronunciation: number; words_json: string }>()
  ).results;
  const mean = (k: "accuracy" | "fluency" | "completeness" | "pronunciation") => Math.round(rows.reduce((n, r) => n + r[k], 0) / rows.length);
  const weak = new Map<string, number>();
  for (const r of rows) {
    for (const w of JSON.parse(r.words_json) as AssessedWord[]) {
      if (w.accuracy < WEAK_BELOW || w.error === "Mispronunciation") weak.set(w.text, (weak.get(w.text) ?? 0) + 1);
    }
  }
  return {
    attempts: total,
    mean: rows.length >= SUMMARY_MIN ? { accuracy: mean("accuracy"), fluency: mean("fluency"), completeness: mean("completeness"), pronunciation: mean("pronunciation") } : null,
    weakCharacters: [...weak].map(([text, times]) => ({ text, times })).sort((a, b) => b.times - a.times || a.text.localeCompare(b.text)).slice(0, 8),
  };
}
