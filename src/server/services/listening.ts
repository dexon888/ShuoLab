/**
 * The "Listen first" exercise (SPEC §5.3 step 2, §6.5, §10). One per session,
 * written once and then kept: asking again returns the same exercise, and a
 * request that arrives while it is being written is told to wait. Answers
 * are kept as first sent, with the reveal time beside them, so an answer
 * given after reading the text is never counted as unassisted listening.
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  LISTENING_FORMAT_NAME,
  LISTENING_OUTPUT_JSON_SCHEMA,
  type ListeningEvent,
  type ListeningExercise,
  type ListeningResponse,
} from "../../shared/listening";
import { ProviderError, type TutorProvider } from "../providers/types";
import { ApiError } from "../validation/errors";
import {
  PREPARED_LISTENING,
  buildListeningInstructions,
  parseListeningOutput,
  toStored,
  listeningCovers,
  type ListeningRejection,
  type StoredListening,
} from "./listening-prompt";
import { accrueSql, getSession } from "./sessions";
import { coverage, coverageTarget } from "../../shared/coverage";
import { knownWords, vocabularySet } from "./known-words";
import { LISTENING_OPERATION, assertWithinBudget, assertWithinRate, recordUsage } from "./usage";

const PENDING_STALE_MS = 60_000;
const MAX_ATTEMPTS = 2;
/** Six lines with pinyin and translation, plus three questions. */
const MAX_OUTPUT_TOKENS = 1400;
/** A whole exchange takes longer to write than a reply: the top of SPEC §9.1's 15–25 seconds. */
const TIMEOUT_MS = 25_000;

interface ListeningRow {
  id: string;
  session_id: string;
  status: string;
  source: string | null;
  model: string | null;
  stand_in: number;
  content_json: string | null;
  created_at: string;
  played_at: string | null;
  revealed_at: string | null;
  answered_at: string | null;
  answers_json: string | null;
  correct_count: number | null;
  question_count: number | null;
}

const COLUMNS =
  "id, session_id, status, source, model, stand_in, content_json, created_at, played_at, revealed_at, answered_at, answers_json, correct_count, question_count";

function readContent(row: ListeningRow): StoredListening {
  try {
    const content = JSON.parse(row.content_json ?? "null") as StoredListening | null;
    if (content && Array.isArray(content.lines) && Array.isArray(content.questions)) return content;
  } catch {
    // Falls through to the error below.
  }
  throw new ApiError("INTERNAL", "The saved listening exercise could not be read.", false);
}

function readAnswers(row: ListeningRow): number[] | null {
  if (row.answers_json === null) return null;
  try {
    const answers: unknown = JSON.parse(row.answers_json);
    return Array.isArray(answers) && answers.every((a) => Number.isInteger(a)) ? (answers as number[]) : null;
  } catch {
    return null;
  }
}

/** True when the answers came before any reveal of the text. */
export function isUnassisted(answeredAt: string, revealedAt: string | null): boolean {
  return revealedAt === null || answeredAt <= revealedAt;
}

export function toExercise(row: ListeningRow): ListeningExercise {
  const content = readContent(row);
  // The right answers stay on the server until the questions are answered or the text is shown.
  const open = row.answered_at !== null || row.revealed_at !== null;
  const result =
    row.answered_at !== null && row.correct_count !== null && row.question_count !== null && row.question_count > 0
      ? { correct: row.correct_count, total: row.question_count, unassisted: isUnassisted(row.answered_at, row.revealed_at) }
      : null;
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source === "prepared" ? "prepared" : "generated",
    model: row.model,
    standIn: row.stand_in === 1,
    lines: content.lines,
    coversTargets: (content as StoredListening & { coversTargets?: boolean }).coversTargets ?? true,
    questions: content.questions.map((q) => ({ questionEn: q.questionEn, optionsEn: q.optionsEn, answerIndex: open ? q.answerIndex : null })),
    createdAt: row.created_at,
    playedAt: row.played_at,
    revealedAt: row.revealed_at,
    answeredAt: row.answered_at,
    answers: readAnswers(row),
    result,
  };
}

async function findRow(d1: D1Database, sessionId: string): Promise<ListeningRow | null> {
  return (await d1.prepare(`SELECT ${COLUMNS} FROM listening_exercises WHERE session_id = ?1`).bind(sessionId).first<ListeningRow>()) ?? null;
}

async function readyRow(d1: D1Database, sessionId: string): Promise<ListeningRow> {
  const row = await findRow(d1, sessionId);
  if (!row || row.status !== "ready") throw new ApiError("NOT_FOUND", "This session has no listening exercise yet.");
  return row;
}

/** The session's finished exercise, if it has one. */
export async function getListening(d1: D1Database, sessionId: string): Promise<ListeningExercise | null> {
  const row = await findRow(d1, sessionId);
  return row?.status === "ready" ? toExercise(row) : null;
}

function providerFailure(error: ProviderError): ApiError {
  switch (error.kind) {
    case "timeout":
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor took too long to write the exercise. Try again.", true);
    case "rate_limited":
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor service is busy or over its own limit. Wait a moment and try again.", true);
    case "quota":
      return new ApiError(
        "PROVIDER_UNAVAILABLE",
        "The OpenAI account has no credit left, or has reached a spending limit set at OpenAI. Add credit or raise the limit in the OpenAI billing settings, then try again.",
      );
    case "auth":
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor service refused the configured key. Check the OPENAI_API_KEY secret.");
    default:
      return new ApiError("PROVIDER_UNAVAILABLE", "The tutor could not be reached to write the exercise. Try again.", true);
  }
}

/** Reserves the session's exercise row, or takes over a failed or abandoned one. Returns its id. */
async function reserve(d1: D1Database, sessionId: string, existing: ListeningRow | null, now: Date): Promise<string> {
  const busy = new ApiError("CONFLICT", "The listening exercise is still being written. Wait a moment.", true);
  if (existing) {
    const staleBefore = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
    const taken = await d1
      .prepare(
        `UPDATE listening_exercises SET status = 'pending', created_at = ?2
WHERE id = ?1 AND (status = 'failed' OR (status = 'pending' AND created_at < ?3))`,
      )
      .bind(existing.id, now.toISOString(), staleBefore)
      .run();
    if (taken.meta.changes !== 1) throw busy;
    return existing.id;
  }
  const id = crypto.randomUUID();
  const inserted = await d1
    .prepare(
      `INSERT INTO listening_exercises (id, session_id, status, created_at) VALUES (?1, ?2, 'pending', ?3)
ON CONFLICT (session_id) DO NOTHING`,
    )
    .bind(id, sessionId, now.toISOString())
    .run();
  if (inserted.meta.changes !== 1) throw busy;
  return id;
}

async function targetsFor(d1: D1Database, sessionId: string): Promise<{ id: string; hanzi: string; pinyin: string | null }[]> {
  const rows = await d1
    .prepare(
      `SELECT ci.id, ci.hanzi, ci.pinyin FROM session_targets st JOIN curriculum_items ci ON ci.id = st.curriculum_item_id
WHERE st.session_id = ?1 ORDER BY st.position`,
    )
    .bind(sessionId)
    .all<{ id: string; hanzi: string; pinyin: string | null }>();
  return rows.results;
}

/**
 * Writes the session's exercise, or returns the one it already has. The model
 * gets two tries; after that a prepared exchange is used, labelled as such.
 */
export async function createListening(
  d1: D1Database,
  provider: TutorProvider,
  sessionId: string,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<ListeningResponse> {
  const session = await getSession(d1, sessionId);
  const existing = await findRow(d1, session.id);
  if (existing?.status === "ready") return { exercise: toExercise(existing), existing: true };
  if (session.status === "complete" || session.status === "abandoned") {
    throw new ApiError("CONFLICT", "This session has ended. Start a new one from Today.");
  }
  if (session.status === "paused") throw new ApiError("CONFLICT", "This session is paused. Resume it to continue.");

  await assertWithinRate(d1, now);
  await assertWithinBudget(d1, provider.paid, now);
  const id = await reserve(d1, session.id, existing, now);

  try {
    const targets = await targetsFor(d1, session.id);
    // Pitched at what the learner knows (SPEC §2.6 rule 4).
    const [vocabulary, known] = await Promise.all([vocabularySet(d1), knownWords(d1, session.id)]);
    const target = provider.mock ? null : coverageTarget(known.set.size);
    let measured: { known: number; total: number } | null = null;
    let stored: StoredListening | null = null;
    let covers = false;
    let retry: ListeningRejection | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !covers; attempt += 1) {
      let result;
      try {
        result = await provider.generate({
          instructions: buildListeningInstructions(session.plan, targets, retry, known.recent),
          messages: [{ role: "user", content: "Write the listening exercise." }],
          format: { name: LISTENING_FORMAT_NAME, schema: LISTENING_OUTPUT_JSON_SCHEMA, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS },
          context: {
            targets: targets.map((t) => ({ id: t.id, hanzi: t.hanzi })),
            colloquial: [],
            grammar: session.plan.grammar.map((g) => ({ id: g.itemId, name: g.name, example: g.example })),
            turnIndex: 0,
            attempt,
          },
        });
      } catch (error) {
        await recordUsage(
          d1,
          { provider: provider.vendor, operation: LISTENING_OPERATION, model: provider.model, usage: { tokensIn: 0, tokensOut: 0 }, estimatedUsd: 0, status: "error", sessionId: session.id },
          now,
        );
        throw error instanceof ProviderError ? providerFailure(error) : error;
      }
      const parsed = parseListeningOutput(result.text);
      await recordUsage(
        d1,
        {
          provider: provider.vendor,
          operation: LISTENING_OPERATION,
          model: provider.model,
          usage: result.usage,
          estimatedUsd: provider.estimateUsd(result.usage),
          status: parsed.ok ? "ok" : "invalid",
          sessionId: session.id,
        },
        now,
      );
      if (parsed.ok) {
        // A usable exchange is kept even if it misses a pattern; the retry asks for one that covers the plan.
        stored = toStored(parsed.output, random);
        const c = coverage(parsed.output.lines.map((l) => l.zh).join(""), vocabulary, known.set);
        measured = { known: c.known, total: c.total };
        const pitched = target === null || c.total === 0 || c.known / c.total >= target;
        covers = listeningCovers(parsed.output.lines, session.plan) && pitched;
        if (!covers) retry = "coverage";
      } else {
        retry = parsed.reason;
      }
    }

    const source = stored === null ? "prepared" : "generated";
    const content = { ...(stored ?? toStored(PREPARED_LISTENING, random)), coversTargets: stored === null ? false : covers, coverage: stored === null ? null : measured };
    const at = now.toISOString();
    await d1.batch([
      d1
        .prepare(
          `UPDATE listening_exercises SET status = 'ready', source = ?2, model = ?3, stand_in = ?4, content_json = ?5, created_at = ?6
WHERE id = ?1 AND status = 'pending'`,
        )
        .bind(id, source, source === "prepared" ? null : provider.model, source === "generated" && provider.mock ? 1 : 0, JSON.stringify(content), at),
      d1
        .prepare(
          `UPDATE sessions SET status = 'active', started_at = COALESCE(started_at, ?2), ${accrueSql("?2")}, last_activity_at = ?2
WHERE id = ?1 AND status IN ('planned','active')`,
        )
        .bind(session.id, at),
    ]);
  } catch (error) {
    await d1.prepare("UPDATE listening_exercises SET status = 'failed' WHERE id = ?1 AND status = 'pending'").bind(id).run();
    throw error;
  }

  return { exercise: toExercise(await readyRow(d1, session.id)), existing: false };
}

/** Records the first play, or the first reveal of the text. Repeating it changes nothing. */
export async function recordListeningEvent(
  d1: D1Database,
  sessionId: string,
  event: ListeningEvent,
  now: Date = new Date(),
): Promise<ListeningResponse> {
  const row = await readyRow(d1, sessionId);
  const column = event === "played" ? "played_at" : "revealed_at";
  await d1.prepare(`UPDATE listening_exercises SET ${column} = COALESCE(${column}, ?2) WHERE id = ?1`).bind(row.id, now.toISOString()).run();
  return { exercise: toExercise(await readyRow(d1, sessionId)), existing: true };
}

/** Scores the answers. The first answers sent are kept; sending the same again returns the same result. */
export async function answerListening(
  d1: D1Database,
  sessionId: string,
  answers: readonly number[],
  now: Date = new Date(),
): Promise<ListeningResponse> {
  const row = await readyRow(d1, sessionId);
  const { questions } = readContent(row);
  if (answers.length !== questions.length || answers.some((a, i) => a >= (questions[i]?.optionsEn.length ?? 0))) {
    throw new ApiError("BAD_REQUEST", `Send one answer for each of the ${questions.length} questions.`);
  }
  if (row.answered_at !== null) {
    if (JSON.stringify(readAnswers(row)) === JSON.stringify(answers)) return { exercise: toExercise(row), existing: true };
    throw new ApiError("CONFLICT", "These questions were already answered. The first answers are kept.");
  }
  const correct = answers.filter((a, i) => a === questions[i]?.answerIndex).length;
  const at = now.toISOString();
  await d1.batch([
    d1
      .prepare(
        `UPDATE listening_exercises SET answered_at = ?2, answers_json = ?3, correct_count = ?4, question_count = ?5
WHERE id = ?1 AND answered_at IS NULL`,
      )
      .bind(row.id, at, JSON.stringify(answers), correct, questions.length),
    d1.prepare(`UPDATE sessions SET ${accrueSql("?2")}, last_activity_at = ?2 WHERE id = ?1 AND status = 'active'`).bind(sessionId, at),
  ]);
  const after = await readyRow(d1, sessionId);
  // Two answers sent at once: whichever arrived first is kept.
  if (JSON.stringify(readAnswers(after)) !== JSON.stringify(answers)) {
    throw new ApiError("CONFLICT", "These questions were already answered. The first answers are kept.");
  }
  return { exercise: toExercise(after), existing: false };
}
