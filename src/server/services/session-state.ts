/**
 * Pause, resume, abandon and complete (SPEC §9), and the end-of-session
 * summary. Every transition is a single conditional UPDATE, so repeating a
 * request, or sending it from two devices, leaves the session in one state.
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  MAX_DEBRIEF_CORRECTIONS,
  type Debrief,
  type SessionAction,
  type SessionStateResponse,
} from "../../shared/debrief";
import type { ListeningExercise } from "../../shared/listening";
import type { SessionDetail } from "../../shared/session";
import type { Turn, TurnCorrection } from "../../shared/tutor";
import { ApiError } from "../validation/errors";
import { getListening } from "./listening";
import { introduceSessionWords } from "./review";
import { accrueSql, getSession } from "./sessions";
import { listTurns } from "./turns";

/** What the session and its turns show happened. No judgement of ability. */
export function buildDebrief(session: SessionDetail, turns: readonly Turn[], listening: ListeningExercise | null = null): Debrief {
  const learnerText = turns.map((t) => t.learnerText).join("\n");
  const tutorText = turns.filter((t) => !t.fallback).map((t) => t.reply.spokenZh).join("\n");

  const words = session.plan.targets.map((target) => ({
    itemId: target.itemId,
    hanzi: target.hanzi,
    pinyin: target.pinyin,
    hskBand: target.hskBand,
    role: target.role,
    usedByLearner: target.hanzi.length > 0 && learnerText.includes(target.hanzi),
    usedByTutor: target.hanzi.length > 0 && tutorText.includes(target.hanzi),
  }));

  const corrections: TurnCorrection[] = [];
  for (const turn of [...turns].reverse()) {
    for (const correction of turn.feedback.corrections) {
      const repeated = corrections.some((c) => c.original === correction.original && c.corrected === correction.corrected);
      if (!repeated && corrections.length < MAX_DEBRIEF_CORRECTIONS) corrections.push(correction);
    }
  }

  return {
    sessionId: session.id,
    practiceSeconds: session.actualSeconds,
    plannedMinutes: session.durationMinutes,
    turns: {
      total: turns.length,
      typed: turns.filter((t) => t.sourceMode === "typed").length,
      spoken: turns.filter((t) => t.sourceMode === "speech").length,
      fallback: turns.filter((t) => t.fallback).length,
    },
    words,
    recommendedReviewItemIds: words.filter((w) => !w.usedByLearner && w.role !== "stretch").map((w) => w.itemId),
    corrections,
    listening: listening?.result ?? null,
  };
}

export async function getSessionState(d1: D1Database, id: string): Promise<SessionStateResponse> {
  const session = await getSession(d1, id);
  const [turns, listening] = await Promise.all([listTurns(d1, session.id), getListening(d1, session.id)]);
  return { session, turns, listening, debrief: session.status === "complete" ? buildDebrief(session, turns, listening) : null };
}

const ENDED = "This session has ended. Start a new one from Today.";

export async function applySessionAction(
  d1: D1Database,
  id: string,
  action: SessionAction,
  now: Date = new Date(),
): Promise<SessionStateResponse> {
  const session = await getSession(d1, id);
  const at = now.toISOString();

  if (action === "pause") {
    if (session.status === "paused") return getSessionState(d1, id);
    if (session.status !== "active") {
      throw new ApiError("CONFLICT", session.status === "planned" ? "This session has not started yet." : ENDED);
    }
    await d1
      .prepare(`UPDATE sessions SET status = 'paused', ${accrueSql("?2")}, last_activity_at = ?2 WHERE id = ?1 AND status = 'active'`)
      .bind(id, at)
      .run();
  } else if (action === "resume") {
    if (session.status === "active") return getSessionState(d1, id);
    if (session.status !== "paused") {
      throw new ApiError("CONFLICT", session.status === "planned" ? "This session has not started yet." : ENDED);
    }
    // The paused stretch is not practice: the clock restarts from now.
    await d1.prepare("UPDATE sessions SET status = 'active', last_activity_at = ?2 WHERE id = ?1 AND status = 'paused'").bind(id, at).run();
  } else {
    if (session.status === "abandoned") return getSessionState(d1, id);
    if (session.status === "complete") {
      throw new ApiError("CONFLICT", "This session is already complete.");
    }
    await d1
      .prepare(
        `UPDATE sessions SET ${session.status === "active" ? `${accrueSql("?2")}, ` : ""}status = 'abandoned', ended_at = ?2, last_activity_at = ?2
WHERE id = ?1 AND status IN ('planned','active','paused')`,
      )
      .bind(id, at)
      .run();
  }
  return getSessionState(d1, id);
}

/** Finishes a session. Asking again returns the same summary. */
export async function completeSession(d1: D1Database, id: string, now: Date = new Date()): Promise<SessionStateResponse> {
  const session = await getSession(d1, id);
  if (session.status === "complete") return getSessionState(d1, id);
  if (session.status === "abandoned") throw new ApiError("CONFLICT", ENDED);
  if (session.status === "planned") {
    throw new ApiError("CONFLICT", "This session has no turns yet, so there is nothing to finish.");
  }
  const at = now.toISOString();
  // Time is added only if the session was running; a paused session already has its total.
  await d1
    .prepare(
      `UPDATE sessions SET
  actual_seconds = CASE WHEN status = 'active' THEN ${accrueSql("?2").replace("actual_seconds = ", "")} ELSE actual_seconds END,
  status = 'complete', ended_at = ?2, last_activity_at = ?2
WHERE id = ?1 AND status IN ('active','paused')`,
    )
    .bind(id, at)
    .run();
  // The words it targeted now have review cards. Safe to repeat.
  await introduceSessionWords(d1, id, now);
  return getSessionState(d1, id);
}
