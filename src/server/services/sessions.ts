import type { D1Database } from "@cloudflare/workers-types";
import { usageWarnings, getColloquialSource, type ColloquialChannel, type ColloquialRegister, type CurrencyStatus } from "../../shared/colloquial";
import { HSK_BANDS, getEdition, isHskBand, type HskBand } from "../../shared/curriculum";
import { ACTIVITY_GAP_CAP_SECONDS } from "../../shared/debrief";
import type { SessionMinutes, SessionStatus } from "../../shared/learning";
import {
  TARGET_COUNTS,
  localStudyDate,
  sessionPlanSchema,
  type PlanRequest,
  type PlanResponse,
  type SessionDetail,
  type SessionKind,
  type SessionListResponse,
  type SessionPlan,
  type SessionSummary,
} from "../../shared/session";
import type { OwnerSettings } from "../../shared/settings";
import { ApiError } from "../validation/errors";
import { getCurriculumStatus, isVocabVerified } from "./curriculum-status";
import {
  buildFreeChatPlan,
  buildHskPlan,
  nextBand,
  weakestSkill,
  type CandidateItem,
  type ColloquialPick,
} from "./planner";
import { getSettings } from "./settings";
import { applyRetention } from "./owner-data";
import { characterLists, daysBefore, grammarCandidates, introTopics, metWords, missedWords, skillStats, topicsAndTasks } from "./plan-inputs";
import { FREE_CHAT_SITUATION, situationFor } from "./situations";

const UNFINISHED: readonly SessionStatus[] = ["planned", "active", "paused"];
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * SQL that adds the time since the learner's last action to `actual_seconds`,
 * capped, so a tab left open does not count as practice. `nowParam` is the
 * bind placeholder holding the current time as an ISO string.
 */
export function accrueSql(nowParam: string): string {
  return `actual_seconds = actual_seconds + MIN(${ACTIVITY_GAP_CAP_SECONDS}, MAX(0, CAST(ROUND((julianday(${nowParam}) - julianday(COALESCE(last_activity_at, ${nowParam}))) * 86400) AS INTEGER)))`;
}

interface SessionRow {
  id: string;
  kind: string;
  edition_id: string | null;
  local_study_date: string;
  duration_target_min: number;
  status: string;
  plan_json: string;
  actual_seconds: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const SESSION_COLUMNS =
  "id, kind, edition_id, local_study_date, duration_target_min, status, plan_json, actual_seconds, created_at, started_at, ended_at";

function parsePlan(row: SessionRow): SessionPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(row.plan_json);
  } catch {
    raw = null;
  }
  const parsed = sessionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    // A stored plan this version cannot read is a server fault, not a client one.
    throw new ApiError("INTERNAL", "This session's plan could not be read.", false);
  }
  return parsed.data;
}

function toSummary(row: SessionRow, plan: SessionPlan): SessionSummary {
  return {
    id: row.id,
    kind: row.kind as SessionKind,
    status: row.status as SessionStatus,
    localStudyDate: row.local_study_date,
    durationMinutes: row.duration_target_min,
    targetBand: plan.targetBand,
    situationTitleEn: plan.situation.titleEn,
    situationTitleZh: plan.situation.titleZh,
    synthetic: plan.synthetic,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function toDetail(row: SessionRow): SessionDetail {
  const plan = parsePlan(row);
  return { ...toSummary(row, plan), editionId: row.edition_id, plan, actualSeconds: row.actual_seconds };
}

interface ItemRow {
  id: string;
  source_id: number;
  hsk_band: string;
  hanzi: string;
  pinyin: string | null;
}

function toCandidate(row: ItemRow): CandidateItem | null {
  return isHskBand(row.hsk_band)
    ? { id: row.id, sourceId: row.source_id, hskBand: row.hsk_band, hanzi: row.hanzi, pinyin: row.pinyin }
    : null;
}

function candidates(rows: ItemRow[]): CandidateItem[] {
  return rows.map(toCandidate).filter((c): c is CandidateItem => c !== null);
}

/** Entries of a band no live session has targeted yet, in syllabus order; then, if the band is used up, from the start again. */
async function bandCandidates(d1: D1Database, editionId: string, band: HskBand, limit: number): Promise<CandidateItem[]> {
  const fresh = await d1
    .prepare(
      `SELECT ci.id, ci.source_id, ci.hsk_band, ci.hanzi, ci.pinyin
FROM curriculum_items ci
WHERE ci.edition_id = ?1 AND ci.item_type = 'vocab' AND ci.hsk_band = ?2
  AND NOT EXISTS (
    SELECT 1 FROM session_targets st JOIN sessions s ON s.id = st.session_id
    WHERE st.curriculum_item_id = ci.id AND s.status <> 'abandoned')
ORDER BY ci.source_id
LIMIT ?3`,
    )
    .bind(editionId, band, limit)
    .all<ItemRow>();
  if (fresh.results.length >= limit) return candidates(fresh.results);

  const wrapped = await d1
    .prepare(
      `SELECT id, source_id, hsk_band, hanzi, pinyin FROM curriculum_items
WHERE edition_id = ?1 AND item_type = 'vocab' AND hsk_band = ?2
ORDER BY source_id LIMIT ?3`,
    )
    // Twice the need, so enough remain after the planner sets aside review picks.
    .bind(editionId, band, limit * 2)
    .all<ItemRow>();
  return candidates([...fresh.results, ...wrapped.results]);
}

/**
 * Entries that earlier live sessions introduced and that are not mastered for
 * both reading and listening, last targeted two or more days ago, longest-ago
 * first (SPEC §6.2 priority b).
 */
async function reviewCandidates(d1: D1Database, editionId: string, limit: number, before = "9999-12-31"): Promise<CandidateItem[]> {
  const rows = await d1
    .prepare(
      `SELECT ci.id, ci.source_id, ci.hsk_band, ci.hanzi, ci.pinyin
FROM session_targets st
JOIN sessions s ON s.id = st.session_id
JOIN curriculum_items ci ON ci.id = st.curriculum_item_id
WHERE s.status <> 'abandoned' AND ci.edition_id = ?1 AND ci.item_type = 'vocab' AND st.role <> 'stretch'
  AND (SELECT COUNT(*) FROM mastery_states ms WHERE ms.curriculum_item_id = ci.id AND ms.state = 'mastered'
       AND ms.skill IN ('reading','listening')) < 2
GROUP BY ci.id
HAVING MAX(s.local_study_date) <= ?3
ORDER BY MAX(s.created_at) ASC, ci.source_id ASC
LIMIT ?2`,
    )
    .bind(editionId, limit, before)
    .all<ItemRow>();
  return candidates(rows.results);
}

interface ColloquialRow {
  id: string;
  source_key: string;
  term: string;
  pinyin: string | null;
  meaning_en: string;
  register: string;
  channel: string;
  currency_status: string;
}

/**
 * At most one colloquial expression (SPEC §6.2 step 4). None at `low`. At
 * `normal` only expressions that are safe to say to anyone or casually, that
 * work out loud, and that are established. `high` also allows typed-only and
 * current slang. Swear-level expressions are never chosen by the planner.
 */
async function pickColloquial(
  d1: D1Database,
  intensity: OwnerSettings["slangIntensity"],
  sessionIndex: number,
): Promise<ColloquialPick | null> {
  if (intensity === "low") return null;
  const filter =
    intensity === "high"
      ? "register IN ('neutral','casual') AND currency_status IN ('steady','hot')"
      : "register IN ('neutral','casual') AND channel IN ('both','spoken') AND currency_status = 'steady'";
  const rows = await d1
    .prepare(
      `SELECT id, source_key, term, pinyin, meaning_en, register, channel, currency_status
FROM colloquial_expressions
WHERE verification_status = 'verified' AND ${filter}
ORDER BY id`,
    )
    .all<ColloquialRow>();
  if (rows.results.length === 0) return null;
  const row = rows.results[sessionIndex % rows.results.length];
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    pinyin: row.pinyin,
    meaningEn: row.meaning_en,
    warnings: usageWarnings({
      register: row.register as ColloquialRegister,
      channel: row.channel as ColloquialChannel,
      currencyStatus: row.currency_status as CurrencyStatus,
      verificationStatus: "verified",
    }),
    synthetic: getColloquialSource(row.source_key)?.synthetic ?? false,
  };
}

/**
 * Checks every target against the database (SPEC §2.4 acceptance): the item
 * must exist in the plan's edition and sit in the band the plan claims.
 * Nothing the plan says about an item is trusted.
 */
export async function assertPlanTargetsValid(d1: D1Database, plan: SessionPlan): Promise<void> {
  if (plan.kind === "free_chat") {
    if (plan.targets.length > 0 || plan.editionId !== null || plan.targetBand !== null) {
      throw new ApiError("BAD_REQUEST", "An open conversation cannot carry syllabus targets.");
    }
    return;
  }
  if (!plan.editionId || !plan.targetBand) {
    throw new ApiError("BAD_REQUEST", "The plan has no edition or study band.");
  }
  const ids = plan.targets.map((t) => t.itemId);
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new ApiError("BAD_REQUEST", "The plan's targets are empty or repeated.");
  }
  const rows = await d1
    .prepare(
      `SELECT id, hsk_band FROM curriculum_items
WHERE edition_id = ?1 AND item_type = 'vocab' AND id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(plan.editionId, JSON.stringify(ids))
    .all<{ id: string; hsk_band: string }>();
  const bands = new Map(rows.results.map((r) => [r.id, r.hsk_band]));
  const stretchBand = nextBand(plan.targetBand);

  for (const target of plan.targets) {
    const actual = bands.get(target.itemId);
    if (actual === undefined) {
      throw new ApiError("BAD_REQUEST", "The plan references an entry that is not in the imported syllabus.");
    }
    if (actual !== target.hskBand) {
      throw new ApiError("BAD_REQUEST", "The plan gives an entry a band that differs from the imported syllabus.");
    }
    if (target.role === "active" && actual !== plan.targetBand) {
      throw new ApiError("BAD_REQUEST", "A new target is not in the session's study band.");
    }
    if (target.role === "stretch" && actual !== stretchBand) {
      throw new ApiError("BAD_REQUEST", "A stretch target is not one band above the study band.");
    }
  }
  const active = plan.targets.filter((t) => t.hskBand === plan.targetBand).length;
  if (active * 2 < plan.targets.length) {
    throw new ApiError("BAD_REQUEST", "Fewer than half of the targets are in the study band.");
  }
  await assertPlanSectionsValid(d1, plan);
}

/** Grammar, characters, topic and task must be imported rows of the right type, at or below the study band. */
async function assertPlanSectionsValid(d1: D1Database, plan: SessionPlan): Promise<void> {
  const wanted = sectionItems(plan);
  if (wanted.length === 0 || !plan.targetBand || !plan.editionId) return;
  const rows = await d1
    .prepare(
      `SELECT id, item_type, hsk_band FROM curriculum_items
WHERE edition_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(plan.editionId, JSON.stringify(wanted.map((w) => w.id)))
    .all<{ id: string; item_type: string; hsk_band: string }>();
  const found = new Map(rows.results.map((r) => [r.id, r]));
  const limit = HSK_BANDS.indexOf(plan.targetBand);
  for (const w of wanted) {
    const row = found.get(w.id);
    if (!row || row.item_type !== w.type) {
      throw new ApiError("BAD_REQUEST", "The plan references a grammar point, character, topic or task that is not imported.");
    }
    if (!isHskBand(row.hsk_band) || HSK_BANDS.indexOf(row.hsk_band) > limit) {
      throw new ApiError("BAD_REQUEST", "A grammar point, character, topic or task in the plan is above the study band.");
    }
  }
}

/** The section rows a plan targets, in the order they are stored. */
function sectionItems(plan: SessionPlan): { id: string; type: "grammar" | "character" | "topic" | "task"; role: "new" | "recycled" | "target" }[] {
  return [
    ...plan.grammar.map((g) => ({ id: g.itemId, type: "grammar" as const, role: g.role })),
    ...plan.characters.map((c) => ({ id: c.itemId, type: "character" as const, role: "target" as const })),
    ...(plan.topic ? [{ id: plan.topic.itemId, type: "topic" as const, role: "target" as const }] : []),
    ...(plan.task ? [{ id: plan.task.itemId, type: "task" as const, role: "target" as const }] : []),
  ];
}

async function insertSession(d1: D1Database, id: string, plan: SessionPlan, createdAt: string): Promise<void> {
  const statements = [
    d1
      .prepare(
        `INSERT INTO sessions (id, kind, edition_id, local_study_date, duration_target_min, status, plan_json, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, 'planned', ?6, ?7)`,
      )
      .bind(id, plan.kind, plan.editionId, plan.localStudyDate, plan.durationMinutes, JSON.stringify(plan), createdAt),
    ...plan.targets.map((target, position) =>
      d1
        .prepare("INSERT INTO session_targets (session_id, curriculum_item_id, role, position) VALUES (?1, ?2, ?3, ?4)")
        .bind(id, target.itemId, target.role, position),
    ),
    ...sectionItems(plan).map((item, position) =>
      d1
        .prepare("INSERT INTO session_items (session_id, curriculum_item_id, item_type, role, position) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(id, item.id, item.type, item.role, position),
    ),
  ];
  // One batch is one transaction: a session is never saved without its targets.
  await d1.batch(statements);
}

async function unfinishedToday(d1: D1Database, date: string): Promise<SessionRow | null> {
  const row = await d1
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM sessions
WHERE local_study_date = ?1 AND status IN ('planned','active','paused')
ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(date)
    .first<SessionRow>();
  return row ?? null;
}

/**
 * Plans today's session and saves it (SPEC §6.2).
 *
 * Asking again on the same day returns the unfinished session rather than a
 * duplicate. If that session has not been started and the request asks for a
 * different length, band or kind, it is replaced.
 */
export async function planSession(d1: D1Database, request: PlanRequest, now: Date = new Date()): Promise<PlanResponse> {
  // Once a day is enough for retention, and planning happens once a day.
  await applyRetention(d1, now);
  const settings = await getSettings(d1);
  const durationMinutes: SessionMinutes = request.durationMinutes ?? settings.sessionMinutes;
  const date = localStudyDate(now, settings.timezone);
  const kind: SessionKind = request.freeChat ? "free_chat" : "hsk";
  const chosenBand = request.studyBand ?? settings.studyBand;
  const targetBand: HskBand = chosenBand ?? "1";

  const existing = await unfinishedToday(d1, date);
  if (existing) {
    const detail = toDetail(existing);
    const same =
      detail.kind === kind &&
      detail.durationMinutes === durationMinutes &&
      (kind === "free_chat" || detail.targetBand === targetBand);
    if (same || existing.status !== "planned") {
      return { session: detail, reused: true };
    }
    await d1.prepare("UPDATE sessions SET status = 'abandoned', ended_at = ?2 WHERE id = ?1").bind(existing.id, now.toISOString()).run();
  }

  let plan: SessionPlan;
  if (kind === "free_chat") {
    plan = buildFreeChatPlan({ durationMinutes, localStudyDate: date, situation: FREE_CHAT_SITUATION });
  } else {
    const status = await getCurriculumStatus(d1);
    if (!status.activeEdition || !isVocabVerified(status)) {
      throw new ApiError(
        "CURRICULUM_MISSING",
        "HSK sessions need the vocabulary import, which has not been done or has not verified. See the Curriculum page.",
      );
    }
    const editionId = status.activeEdition.id;
    const wanted = TARGET_COUNTS[durationMinutes];
    const stretchBand = nextBand(targetBand);
    const prior = await d1
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'hsk' AND status <> 'abandoned'")
      .first<{ n: number }>();
    const sessionIndex = prior?.n ?? 0;

    const [active, review, stretch, colloquial, missed, grammar, characters, met, stats] = await Promise.all([
      bandCandidates(d1, editionId, targetBand, wanted),
      reviewCandidates(d1, editionId, wanted, daysBefore(date, 2)),
      stretchBand ? bandCandidates(d1, editionId, stretchBand, 1) : Promise.resolve([]),
      pickColloquial(d1, settings.slangIntensity, sessionIndex),
      missedWords(d1, editionId, now),
      grammarCandidates(d1, editionId, targetBand, date),
      characterLists(d1, editionId, targetBand),
      metWords(d1, editionId),
      skillStats(d1, now),
    ]);
    const avoid = await introTopics(d1, [...missed, ...review].map((c) => c.id));
    const { topics, tasks } = await topicsAndTasks(d1, editionId, targetBand, sessionIndex, avoid);
    if (active.length === 0) {
      throw new ApiError("CURRICULUM_MISSING", "No vocabulary is imported for that band.");
    }

    plan = buildHskPlan({
      editionId,
      synthetic: getEdition(editionId)?.synthetic ?? status.activeEdition.synthetic,
      targetBand,
      bandSource: chosenBand ? "owner_choice" : "suggestion",
      durationMinutes,
      localStudyDate: date,
      situation: situationFor(sessionIndex),
      activeCandidates: active,
      reviewCandidates: review,
      stretchCandidates: stretch,
      colloquial,
      missedCandidates: missed,
      recycledGrammar: grammar.recycled,
      newGrammar: grammar.fresh,
      characters,
      metWords: met,
      topics,
      tasks,
      weakestSkill: weakestSkill(stats),
    });
  }

  await assertPlanTargetsValid(d1, plan);
  const id = crypto.randomUUID();
  await insertSession(d1, id, plan, now.toISOString());
  return { session: await getSession(d1, id), reused: false };
}

export async function getSession(d1: D1Database, id: string): Promise<SessionDetail> {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new ApiError("BAD_REQUEST", "That is not a session id.");
  }
  const row = await d1.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?1`).bind(id).first<SessionRow>();
  if (!row) throw new ApiError("NOT_FOUND", "No such session.");
  return toDetail(row);
}

export async function listSessions(d1: D1Database, limit: number, now: Date = new Date()): Promise<SessionListResponse> {
  const settings = await getSettings(d1);
  const rows = await d1
    .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE status <> 'abandoned' ORDER BY created_at DESC LIMIT ?1`)
    .bind(limit)
    .all<SessionRow>();
  const today = await unfinishedToday(d1, localStudyDate(now, settings.timezone));
  return {
    sessions: rows.results.map((row) => toSummary(row, parsePlan(row))),
    resumable: today && UNFINISHED.includes(today.status as SessionStatus) ? toSummary(today, parsePlan(today)) : null,
  };
}
