/**
 * The spend ledger and the gates built on it (SPEC §4.3, §16). Every provider
 * call is written to `usage_events`; the month's total is a sum over that
 * table. Amounts are this app's estimates, never a provider bill.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { USAGE_DISCLAIMER, type MonthlyUsageResponse } from "../../shared/tutor";
import type { TokenUsage } from "../providers/types";
import { ApiError } from "../validation/errors";
import { getSettings } from "./settings";
import { getSpeechAllowance, speechLimits, type SpeechLimits } from "./speech";

export const TUTOR_OPERATION = "tutor_turn";
/** Writing a listening exercise. It uses the tutor model, so it shares the tutor's limits and totals. */
export const LISTENING_OPERATION = "listening_exercise";

/** Tutor calls allowed in any 60 seconds and any 24 hours, counting retries. */
export const MAX_TUTOR_CALLS_PER_MINUTE = 20;
export const MAX_TUTOR_CALLS_PER_DAY = 600;

export type UsageStatus = "ok" | "invalid" | "error";

export interface UsageEventInput {
  provider: string;
  operation: string;
  model: string | null;
  usage: TokenUsage;
  estimatedUsd: number;
  status: UsageStatus;
  sessionId: string | null;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export async function recordUsage(d1: D1Database, event: UsageEventInput, now: Date): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO usage_events (id, provider, operation, model, tokens_in, tokens_out, estimated_usd, status, session_id, recorded_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      crypto.randomUUID(),
      event.provider,
      event.operation,
      event.model,
      event.usage.tokensIn,
      event.usage.tokensOut,
      roundUsd(event.estimatedUsd),
      event.status,
      event.sessionId,
      now.toISOString(),
    )
    .run();
}

/** First instant of the UTC month containing `now`, and of the next one. */
export function utcMonthBounds(now: Date): { month: string; start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    month: `${y}-${String(m + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(y, m, 1)).toISOString(),
    end: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
  };
}

export async function getMonthlyUsage(
  d1: D1Database,
  now: Date = new Date(),
  limits: SpeechLimits = speechLimits({}),
): Promise<MonthlyUsageResponse> {
  const settings = await getSettings(d1);
  const { month, start, end } = utcMonthBounds(now);
  const [all, tutor] = await d1.batch<{ n: number; tin: number | null; tout: number | null; usd: number | null }>([
    d1
      .prepare("SELECT COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(estimated_usd) AS usd FROM usage_events WHERE recorded_at >= ?1 AND recorded_at < ?2")
      .bind(start, end),
    d1
      .prepare("SELECT COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(estimated_usd) AS usd FROM usage_events WHERE recorded_at >= ?1 AND recorded_at < ?2 AND operation IN (?3, ?4)")
      .bind(start, end, TUTOR_OPERATION, LISTENING_OPERATION),
  ]);
  const total = all?.results[0];
  const tutorRow = tutor?.results[0];
  if (!total || !tutorRow) {
    throw new Error("usage totals unavailable");
  }
  const estimatedUsd = roundUsd(total.usd ?? 0);
  const { softUsd, hardUsd } = settings.limits;
  return {
    month,
    estimatedUsd,
    softUsd,
    hardUsd,
    remainingUsd: roundUsd(Math.max(0, hardUsd - estimatedUsd)),
    softLimitReached: estimatedUsd >= softUsd,
    hardLimitReached: estimatedUsd >= hardUsd,
    tutor: {
      requests: tutorRow.n,
      tokensIn: tutorRow.tin ?? 0,
      tokensOut: tutorRow.tout ?? 0,
      estimatedUsd: roundUsd(tutorRow.usd ?? 0),
    },
    speech: await getSpeechAllowance(d1, limits, now),
    disclaimer: USAGE_DISCLAIMER,
  };
}

/**
 * Refuses a paid call once this month's estimate has reached the stop amount.
 * If the total cannot be worked out, the call is refused too: the gate fails
 * closed rather than letting spending go unchecked.
 */
export async function assertWithinBudget(d1: D1Database, paid: boolean, now: Date): Promise<void> {
  if (!paid) return;
  let usage: MonthlyUsageResponse;
  try {
    usage = await getMonthlyUsage(d1, now);
  } catch {
    throw new ApiError("PROVIDER_UNAVAILABLE", "This month's spending could not be checked, so the tutor is paused. Try again shortly.", true);
  }
  if (usage.hardLimitReached) {
    throw new ApiError(
      "BUDGET_EXCEEDED",
      `This month's estimated spending has reached the stop amount of US$${usage.hardUsd.toFixed(2)} set in Settings. The tutor is paused until next month or until you raise the amount.`,
    );
  }
}

/** Refuses a tutor call when too many were made in the last minute or day. */
export async function assertWithinRate(d1: D1Database, now: Date): Promise<void> {
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const row = await d1
    .prepare(
      `SELECT
  SUM(CASE WHEN recorded_at > ?1 THEN 1 ELSE 0 END) AS minute,
  COUNT(*) AS day
FROM usage_events WHERE operation IN (?3, ?4) AND recorded_at > ?2`,
    )
    .bind(minuteAgo, dayAgo, TUTOR_OPERATION, LISTENING_OPERATION)
    .first<{ minute: number | null; day: number }>();
  if ((row?.day ?? 0) >= MAX_TUTOR_CALLS_PER_DAY) {
    throw new ApiError("RATE_LIMITED", "Today's limit on tutor requests has been reached. Try again tomorrow.");
  }
  if ((row?.minute ?? 0) >= MAX_TUTOR_CALLS_PER_MINUTE) {
    throw new ApiError("RATE_LIMITED", "Too many tutor requests in the last minute. Wait a moment and try again.", true);
  }
}
