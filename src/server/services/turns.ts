/**
 * Tutor turns (SPEC §6.3, §6.4, §9, REL-01).
 *
 * A turn is saved exactly once per `clientTurnId`. The row is reserved before
 * the tutor is called, so a message that is resent while the first request is
 * still running, or after it finished, never produces a second turn or a
 * second charge.
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  MAX_TURNS_PER_SESSION,
  turnSchema,
  type Turn,
  type TurnRequest,
  type TurnResponse,
} from "../../shared/tutor";
import { ProviderError, type TutorMessage, type TutorProvider } from "../providers/types";
import { ApiError } from "../validation/errors";
import { accrueSql, getSession } from "./sessions";
import {
  buildInstructions,
  checkReferences,
  fallbackReply,
  parseTutorOutput,
  type AllowedColloquial,
  type AllowedTarget,
  type RejectionReason,
} from "./tutor-prompt";
import { TUTOR_OPERATION, assertWithinBudget, assertWithinRate, getMonthlyUsage, recordUsage } from "./usage";

/** A reserved turn older than this is taken to be abandoned and may be retried. */
const PENDING_STALE_MS = 60_000;
/** How many earlier turns are sent to the tutor as context. */
const HISTORY_TURNS = 8;
const MAX_ATTEMPTS = 2;

interface TurnRow {
  id: string;
  client_turn_id: string;
  source_mode: string;
  asr_text: string;
  asr_uncertain: number;
  status: string;
  ai_reply_json: string | null;
  created_at: string;
}

const TURN_COLUMNS = "id, client_turn_id, source_mode, asr_text, asr_uncertain, status, ai_reply_json, created_at";

/** What is stored in `ai_reply_json`: the validated reply, never raw model text. */
type StoredReply = Pick<Turn, "reply" | "referencedCurriculumItemIds" | "referencedColloquialIds" | "feedback" | "fallback">;

function toTurn(row: TurnRow, position: number): Turn {
  let stored: unknown;
  try {
    stored = JSON.parse(row.ai_reply_json ?? "null");
  } catch {
    stored = null;
  }
  const parsed = turnSchema.safeParse({
    ...(typeof stored === "object" && stored !== null ? stored : {}),
    turnId: row.id,
    clientTurnId: row.client_turn_id,
    position,
    sourceMode: row.source_mode,
    learnerText: row.asr_text,
    createdAt: row.created_at,
  });
  if (!parsed.success) {
    throw new ApiError("INTERNAL", "A saved turn could not be read.", false);
  }
  return parsed.data;
}

/** The finished turns of a session, oldest first. */
export async function listTurns(d1: D1Database, sessionId: string): Promise<Turn[]> {
  const rows = await d1
    .prepare(`SELECT ${TURN_COLUMNS} FROM conversation_turns WHERE session_id = ?1 AND status = 'complete' ORDER BY created_at, rowid`)
    .bind(sessionId)
    .all<TurnRow>();
  return rows.results.map((row, position) => toTurn(row, position));
}

async function findTurn(d1: D1Database, sessionId: string, clientTurnId: string): Promise<TurnRow | null> {
  const row = await d1
    .prepare(`SELECT ${TURN_COLUMNS} FROM conversation_turns WHERE session_id = ?1 AND client_turn_id = ?2`)
    .bind(sessionId, clientTurnId)
    .first<TurnRow>();
  return row ?? null;
}

/** The session's targets as the database has them. The plan's own text is not trusted for this. */
async function allowedTargets(d1: D1Database, sessionId: string): Promise<AllowedTarget[]> {
  const rows = await d1
    .prepare(
      `SELECT ci.id, ci.hanzi, ci.pinyin, ci.hsk_band, st.role
FROM session_targets st JOIN curriculum_items ci ON ci.id = st.curriculum_item_id
WHERE st.session_id = ?1 ORDER BY st.position`,
    )
    .bind(sessionId)
    .all<{ id: string; hanzi: string; pinyin: string | null; hsk_band: string; role: string }>();
  return rows.results.map((r) => ({ id: r.id, hanzi: r.hanzi, pinyin: r.pinyin, hskBand: r.hsk_band, role: r.role }));
}

/** The plan's colloquial expressions that still exist in the colloquial table. */
async function allowedColloquial(
  d1: D1Database,
  planned: readonly { id: string; meaningEn: string; warnings: string[] }[],
): Promise<AllowedColloquial[]> {
  if (planned.length === 0) return [];
  const rows = await d1
    .prepare("SELECT id, term FROM colloquial_expressions WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(planned.map((p) => p.id)))
    .all<{ id: string; term: string }>();
  const terms = new Map(rows.results.map((r) => [r.id, r.term]));
  return planned.flatMap((p) => {
    const term = terms.get(p.id);
    return term === undefined ? [] : [{ id: p.id, term, meaningEn: p.meaningEn, warnings: p.warnings }];
  });
}

function providerFailure(error: ProviderError): ApiError {
  switch (error.kind) {
    case "timeout":
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor took too long to answer. Your message is kept; try sending it again.", true);
    case "rate_limited":
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor service is busy or over its own limit. Wait a moment and try again.", true);
    case "auth":
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor service refused the configured key. Check the OPENAI_API_KEY secret.");
    default:
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor could not be reached. Your message is kept; try sending it again.", true);
  }
}

async function replay(d1: D1Database, sessionId: string, row: TurnRow, provider: TutorProvider, now: Date): Promise<TurnResponse> {
  const turns = await listTurns(d1, sessionId);
  const turn = turns.find((t) => t.turnId === row.id);
  if (!turn) throw new ApiError("INTERNAL", "A saved turn could not be read.", false);
  const [session, month] = await Promise.all([getSession(d1, sessionId), getMonthlyUsage(d1, now)]);
  return {
    sessionId,
    sessionStatus: session.status,
    turn,
    replayed: true,
    provider: { vendor: provider.vendor, model: provider.model, mock: provider.mock },
    usage: { estimatedUsdThisTurn: 0, monthEstimatedUsd: month.estimatedUsd, softLimitReached: month.softLimitReached },
  };
}

/**
 * Reserves the turn row. Returns its id, or throws 409 when another request
 * holds it. A failed or abandoned reservation is taken over, keeping its id.
 */
async function reserveTurn(
  d1: D1Database,
  sessionId: string,
  request: TurnRequest,
  existing: TurnRow | null,
  now: Date,
): Promise<string> {
  const uncertain = request.sourceMode === "speech" && request.asrUncertain ? 1 : 0;
  const busy = new ApiError("CONFLICT", "This message is still being answered. Wait a moment.", true);

  if (existing) {
    const staleBefore = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
    const taken = await d1
      .prepare(
        `UPDATE conversation_turns
SET status = 'pending', asr_text = ?2, source_mode = ?3, asr_uncertain = ?4, created_at = ?5
WHERE id = ?1 AND (status = 'failed' OR (status = 'pending' AND created_at < ?6))`,
      )
      .bind(existing.id, request.transcript, request.sourceMode, uncertain, now.toISOString(), staleBefore)
      .run();
    if (taken.meta.changes !== 1) throw busy;
    return existing.id;
  }

  const id = crypto.randomUUID();
  const inserted = await d1
    .prepare(
      `INSERT INTO conversation_turns (id, session_id, client_turn_id, source_mode, asr_text, asr_uncertain, status, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)
ON CONFLICT (session_id, client_turn_id) DO NOTHING`,
    )
    .bind(id, sessionId, request.clientTurnId, request.sourceMode, request.transcript, uncertain, now.toISOString())
    .run();
  // Another request with the same clientTurnId got there first.
  if (inserted.meta.changes !== 1) throw busy;
  return id;
}

async function markFailed(d1: D1Database, turnId: string): Promise<void> {
  await d1.prepare("UPDATE conversation_turns SET status = 'failed' WHERE id = ?1 AND status = 'pending'").bind(turnId).run();
}

export async function takeTurn(
  d1: D1Database,
  provider: TutorProvider,
  sessionId: string,
  request: TurnRequest,
  now: Date = new Date(),
): Promise<TurnResponse> {
  const session = await getSession(d1, sessionId);
  if (session.status === "complete" || session.status === "abandoned") {
    throw new ApiError("CONFLICT", "This session has ended. Start a new one from Today.");
  }

  const existing = await findTurn(d1, sessionId, request.clientTurnId);
  if (existing?.status === "complete") {
    if (existing.asr_text !== request.transcript) {
      throw new ApiError("CONFLICT", "That clientTurnId was already used for a different message.");
    }
    return replay(d1, sessionId, existing, provider, now);
  }
  if (session.status === "paused") {
    throw new ApiError("CONFLICT", "This session is paused. Resume it to continue.");
  }

  const done = await d1
    .prepare("SELECT COUNT(*) AS n FROM conversation_turns WHERE session_id = ?1 AND status = 'complete'")
    .bind(sessionId)
    .first<{ n: number }>();
  const turnIndex = done?.n ?? 0;
  if (turnIndex >= MAX_TURNS_PER_SESSION) {
    throw new ApiError("RATE_LIMITED", `This session has reached its limit of ${MAX_TURNS_PER_SESSION} turns. Finish it and start a new one.`);
  }
  await assertWithinRate(d1, now);
  await assertWithinBudget(d1, provider.paid, now);

  const turnId = await reserveTurn(d1, sessionId, request, existing, now);
  const uncertain = request.sourceMode === "speech" && request.asrUncertain;

  let stored: StoredReply | null = null;
  let spentUsd = 0;
  try {
    const [targets, colloquial, history] = await Promise.all([
      allowedTargets(d1, sessionId),
      allowedColloquial(d1, session.plan.colloquial),
      listTurns(d1, sessionId),
    ]);
    const messages: TutorMessage[] = [
      ...history.slice(-HISTORY_TURNS).flatMap((t): TutorMessage[] => [
        { role: "user", content: t.learnerText },
        { role: "assistant", content: t.reply.spokenZh },
      ]),
      { role: "user", content: request.transcript },
    ];

    let retryReason: RejectionReason | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && stored === null; attempt += 1) {
      const instructions = buildInstructions({ plan: session.plan, targets, colloquial, asrUncertain: uncertain, retryReason });
      let result;
      try {
        result = await provider.generate({
          instructions,
          messages,
          context: {
            targets: targets.map((t) => ({ id: t.id, hanzi: t.hanzi })),
            colloquial: colloquial.map((c) => ({ id: c.id, term: c.term })),
            turnIndex,
            attempt,
          },
        });
      } catch (error) {
        // The call may still have been billed; with no token counts there is nothing to estimate.
        await recordUsage(
          d1,
          { provider: provider.vendor, operation: TUTOR_OPERATION, model: provider.model, usage: { tokensIn: 0, tokensOut: 0 }, estimatedUsd: 0, status: "error", sessionId },
          now,
        );
        throw error instanceof ProviderError ? providerFailure(error) : error;
      }

      const parsed = parseTutorOutput(result.text);
      const usd = provider.estimateUsd(result.usage);
      spentUsd += usd;
      await recordUsage(
        d1,
        { provider: provider.vendor, operation: TUTOR_OPERATION, model: provider.model, usage: result.usage, estimatedUsd: usd, status: parsed.ok ? "ok" : "invalid", sessionId },
        now,
      );

      if (parsed.ok) {
        const refs = checkReferences(parsed.output, targets, colloquial);
        const feedback = parsed.output.semantic_feedback;
        stored = {
          reply: {
            spokenZh: parsed.output.spoken_reply_zh,
            pinyin: parsed.output.optional_pinyin,
            translationEn: parsed.output.optional_translation_en,
          },
          referencedCurriculumItemIds: refs.curriculumItemIds,
          referencedColloquialIds: refs.colloquialIds,
          feedback: {
            understoodIntent: feedback.understood_intent,
            // An unsure transcript is not evidence of a learner error (SPEC §6.3).
            corrections: uncertain
              ? []
              : feedback.corrections.map((c) => ({ original: c.original, corrected: c.corrected, noteEn: c.note_en })),
            encouragementZh: feedback.encouragement_zh,
            transcriptUncertain: uncertain,
          },
          fallback: false,
        };
      } else {
        retryReason = parsed.reason;
      }
    }

    if (stored === null) {
      // Two unusable answers: a prepared reply, with no feedback recorded (SPEC §6.4).
      const prepared = fallbackReply(turnIndex);
      stored = {
        reply: { spokenZh: prepared.zh, pinyin: prepared.pinyin, translationEn: prepared.en },
        referencedCurriculumItemIds: [],
        referencedColloquialIds: [],
        feedback: { understoodIntent: null, corrections: [], encouragementZh: null, transcriptUncertain: uncertain },
        fallback: true,
      };
    }

    const completedAt = now.toISOString();
    await d1.batch([
      d1
        .prepare(
          `UPDATE conversation_turns
SET status = 'complete', ai_reply_zh = ?2, ai_reply_json = ?3, is_fallback = ?4, model = ?5, completed_at = ?6
WHERE id = ?1 AND status = 'pending'`,
        )
        .bind(turnId, stored.reply.spokenZh, JSON.stringify(stored), stored.fallback ? 1 : 0, provider.model, completedAt),
      d1
        .prepare(
          `UPDATE sessions SET status = 'active', started_at = COALESCE(started_at, ?2), model = ?3, ${accrueSql("?2")}, last_activity_at = ?2
WHERE id = ?1 AND status IN ('planned','active')`,
        )
        .bind(sessionId, completedAt, provider.model),
    ]);
  } catch (error) {
    await markFailed(d1, turnId);
    throw error;
  }

  const turns = await listTurns(d1, sessionId);
  const turn = turns.find((t) => t.turnId === turnId);
  if (!turn) throw new ApiError("INTERNAL", "The turn could not be saved. Try again.", true);
  const [after, month] = await Promise.all([getSession(d1, sessionId), getMonthlyUsage(d1, now)]);
  return {
    sessionId,
    sessionStatus: after.status,
    turn,
    replayed: false,
    provider: { vendor: provider.vendor, model: provider.model, mock: provider.mock },
    usage: {
      estimatedUsdThisTurn: Math.round(spentUsd * 1_000_000) / 1_000_000,
      monthEstimatedUsd: month.estimatedUsd,
      softLimitReached: month.softLimitReached,
    },
  };
}
