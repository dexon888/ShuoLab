/**
 * Speech tokens and the free-tier count (SPEC §4.3, §7.1). Speech minutes and
 * voice characters are free on Azure F0 up to a monthly allowance, and the
 * app never moves to a paid tier, so the gate here is the allowance, not a
 * dollar amount. The browser reports what each recognition and spoken reply
 * used; the Worker cannot see the audio.
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  F0_RECOGNITION_SECONDS_PER_MONTH,
  F0_SYNTHESIS_CHARS_PER_MONTH,
  type SpeechAllowance,
  type SpeechTokenResponse,
  type SpeechUsageRequest,
  type SpeechUsageResponse,
} from "../../shared/speech";
import { hasValue, type Env } from "../env";
import { ProviderError, type SpeechTokenProvider } from "../providers/types";
import { ApiError } from "../validation/errors";
import { utcMonthBounds } from "./usage";

export const SPEECH_TOKEN_OPERATION = "speech_token";
export const SPEECH_RECOGNITION_OPERATION = "speech_recognition";
export const SPEECH_SYNTHESIS_OPERATION = "speech_synthesis";

/** A token lasts nine minutes in use; these allow refreshes and reloads with room to spare. */
export const MAX_SPEECH_TOKENS_PER_MINUTE = 6;
export const MAX_SPEECH_TOKENS_PER_DAY = 300;

export interface SpeechLimits {
  recognitionSeconds: number;
  synthesisChars: number;
}

/** A configured limit may only lower the free allowance, never raise it past it. */
function lowerLimit(value: string | undefined, allowance: number): number {
  if (!hasValue(value)) return allowance;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, allowance) : allowance;
}

export function speechLimits(env: Pick<Env, "AZURE_RECOGNITION_SECONDS_PER_MONTH" | "AZURE_SYNTHESIS_CHARS_PER_MONTH">): SpeechLimits {
  return {
    recognitionSeconds: lowerLimit(env.AZURE_RECOGNITION_SECONDS_PER_MONTH, F0_RECOGNITION_SECONDS_PER_MONTH),
    synthesisChars: lowerLimit(env.AZURE_SYNTHESIS_CHARS_PER_MONTH, F0_SYNTHESIS_CHARS_PER_MONTH),
  };
}

export async function getSpeechAllowance(d1: D1Database, limits: SpeechLimits, now: Date): Promise<SpeechAllowance> {
  const { month, start, end } = utcMonthBounds(now);
  const row = await d1
    .prepare(
      `SELECT
  COALESCE(SUM(CASE WHEN operation = ?3 THEN audio_seconds ELSE 0 END), 0) AS seconds,
  COALESCE(SUM(CASE WHEN operation = ?4 THEN tts_chars ELSE 0 END), 0) AS chars
FROM usage_events WHERE recorded_at >= ?1 AND recorded_at < ?2`,
    )
    .bind(start, end, SPEECH_RECOGNITION_OPERATION, SPEECH_SYNTHESIS_OPERATION)
    .first<{ seconds: number; chars: number }>();
  if (!row) throw new Error("speech totals unavailable");
  const recognitionSeconds = Math.round(row.seconds * 10) / 10;
  return {
    month,
    recognitionSeconds,
    recognitionLimitSeconds: limits.recognitionSeconds,
    synthesisChars: row.chars,
    synthesisLimitChars: limits.synthesisChars,
    recognitionAvailable: recognitionSeconds < limits.recognitionSeconds,
    synthesisAvailable: row.chars < limits.synthesisChars,
  };
}

async function assertTokenRate(d1: D1Database, now: Date): Promise<void> {
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const row = await d1
    .prepare(
      `SELECT SUM(CASE WHEN recorded_at > ?1 THEN 1 ELSE 0 END) AS minute, COUNT(*) AS day
FROM usage_events WHERE operation = ?3 AND recorded_at > ?2`,
    )
    .bind(minuteAgo, dayAgo, SPEECH_TOKEN_OPERATION)
    .first<{ minute: number | null; day: number }>();
  if ((row?.day ?? 0) >= MAX_SPEECH_TOKENS_PER_DAY) {
    throw new ApiError("RATE_LIMITED", "Today's limit on speech sessions has been reached. Typed answers still work.");
  }
  if ((row?.minute ?? 0) >= MAX_SPEECH_TOKENS_PER_MINUTE) {
    throw new ApiError("RATE_LIMITED", "Too many speech requests in the last minute. Wait a moment, or type your answer.", true);
  }
}

function speechFailure(error: ProviderError): ApiError {
  switch (error.kind) {
    case "auth":
      return new ApiError(
        "PROVIDER_UNAVAILABLE",
        "Azure refused the speech key. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION. Typed answers still work.",
      );
    case "rate_limited":
      return new ApiError("PROVIDER_UNAVAILABLE", "Azure Speech is busy or over its own limit. Type your answer, or try again shortly.", true);
    default:
      return new ApiError("PROVIDER_UNAVAILABLE", "Azure Speech could not be reached. Type your answer, or try again shortly.", true);
  }
}

async function recordTokenEvent(d1: D1Database, vendor: string, status: "ok" | "error", now: Date): Promise<void> {
  // The token itself is never written anywhere.
  await d1
    .prepare("INSERT INTO usage_events (id, provider, operation, status, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(crypto.randomUUID(), vendor, SPEECH_TOKEN_OPERATION, status, now.toISOString())
    .run();
}

/**
 * Issues a short-lived Azure token. Refused once both this month's
 * recognition and voice allowances are used up; when only one is, the token
 * is issued and the allowance says which half is still available.
 */
export async function issueSpeechToken(
  d1: D1Database,
  provider: SpeechTokenProvider,
  limits: SpeechLimits,
  now: Date = new Date(),
): Promise<SpeechTokenResponse> {
  let allowance: SpeechAllowance;
  try {
    allowance = await getSpeechAllowance(d1, limits, now);
  } catch {
    // Fail closed: without the count, the free allowance cannot be protected.
    throw new ApiError("PROVIDER_UNAVAILABLE", "This month's speech use could not be checked. Type your answer, or try again shortly.", true);
  }
  if (!allowance.recognitionAvailable && !allowance.synthesisAvailable) {
    throw new ApiError(
      "BUDGET_EXCEEDED",
      "This month's free speech allowance is used up. Speech comes back next month; typed answers and written replies still work.",
    );
  }
  await assertTokenRate(d1, now);

  try {
    const token = await provider.issueToken(now);
    await recordTokenEvent(d1, provider.vendor, "ok", now);
    return { ...token, mock: provider.mock, allowance };
  } catch (error) {
    await recordTokenEvent(d1, provider.vendor, "error", now);
    throw error instanceof ProviderError ? speechFailure(error) : error;
  }
}

/** Counts one recognition or one spoken reply. A resent report is counted once. */
export async function recordSpeechUsage(
  d1: D1Database,
  report: SpeechUsageRequest,
  vendor: string,
  limits: SpeechLimits,
  now: Date = new Date(),
): Promise<SpeechUsageResponse> {
  const recognition = report.kind === "recognition";
  const result = await d1
    .prepare(
      `INSERT INTO usage_events (id, provider, operation, audio_seconds, tts_chars, status, session_id, client_event_id, recorded_at)
VALUES (?1, ?2, ?3, ?4, ?5, 'ok', ?6, ?7, ?8)
ON CONFLICT (client_event_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      vendor,
      recognition ? SPEECH_RECOGNITION_OPERATION : SPEECH_SYNTHESIS_OPERATION,
      recognition ? Math.round(report.audioSeconds * 10) / 10 : 0,
      recognition ? 0 : report.characters,
      report.sessionId ?? null,
      report.clientEventId,
      now.toISOString(),
    )
    .run();
  return { recorded: result.meta.changes === 1, allowance: await getSpeechAllowance(d1, limits, now) };
}
