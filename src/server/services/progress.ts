/**
 * The progress summary (SPEC §5.6, §6.5). Read-only: it counts what the
 * evidence tables hold and never infers ability from a streak or exposure.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { HSK_BANDS, VOCAB_NEW_ENTRIES_BY_BAND, getEdition } from "../../shared/curriculum";
import { MASTERY_STATES, SKILLS, type Skill } from "../../shared/learning";
import { MIN_OBSERVATIONS, rateOrNull, type ProgressSummary, type ProgressWindow, type SectionCoverage, type SkillCounts } from "../../shared/progress";
import { localStudyDate } from "../../shared/session";
import { OWNER_ID } from "../db/schema";
import { getSettings } from "./settings";

const DAY_MS = 86_400_000;

/** The last `days` calendar dates in the time zone, oldest first, ending today. */
export function windowDates(now: Date, days: number, timeZone: string): string[] {
  const dates = new Set<string>();
  // Stepping back in hours, not days, is safe across daylight-saving changes.
  for (let h = 0; dates.size < days && h < (days + 2) * 24; h += 1) {
    dates.add(localStudyDate(new Date(now.getTime() - h * 3_600_000), timeZone));
  }
  return [...dates].slice(0, days).reverse();
}

function emptyCounts(): SkillCounts {
  return { introduced: 0, practiced: 0, developing: 0, mastered: 0 };
}

function emptyRow() {
  return {
    entries: 0,
    introduced: 0,
    bySkill: Object.fromEntries(SKILLS.map((s) => [s, emptyCounts()])) as Record<Skill, SkillCounts>,
  };
}

/** Grammar or character coverage by band against the imported rows (SPEC §8.3). Null when not imported. */
async function sectionCoverage(d1: D1Database, editionId: string, itemType: "grammar" | "character"): Promise<SectionCoverage | null> {
  const [entries, states, introduced, verified] = await d1.batch<Record<string, unknown>>([
    d1.prepare("SELECT hsk_band AS band, COUNT(*) AS n FROM curriculum_items WHERE edition_id = ?1 AND item_type = ?2 GROUP BY 1").bind(editionId, itemType),
    d1
      .prepare(
        `SELECT ci.hsk_band AS band, ms.skill, ms.state, COUNT(*) AS n
FROM mastery_states ms JOIN curriculum_items ci ON ci.id = ms.curriculum_item_id
WHERE ms.owner_id = ?1 AND ci.edition_id = ?2 AND ci.item_type = ?3 AND ms.state <> 'unseen'
GROUP BY 1, 2, 3`,
      )
      .bind(OWNER_ID, editionId, itemType),
    d1
      .prepare(
        `SELECT ci.hsk_band AS band, COUNT(DISTINCT ms.curriculum_item_id) AS n
FROM mastery_states ms JOIN curriculum_items ci ON ci.id = ms.curriculum_item_id
WHERE ms.owner_id = ?1 AND ci.edition_id = ?2 AND ci.item_type = ?3 AND ms.state <> 'unseen' GROUP BY 1`,
      )
      .bind(OWNER_ID, editionId, itemType),
    d1
      .prepare("SELECT COUNT(*) AS n FROM source_manifests WHERE edition_id = ?1 AND dataset_kind = ?2 AND verification_status = 'verified'")
      .bind(editionId, itemType),
  ]);
  const entryRows = (entries?.results ?? []) as { band: string; n: number }[];
  if (entryRows.length === 0) return null;
  const bands = HSK_BANDS.map((band) => ({ band, ...emptyRow() }));
  const total = emptyRow();
  fill(bands, total, entryRows, (introduced?.results ?? []) as { band: string; n: number }[], (states?.results ?? []) as { band: string; skill: Skill; state: string; n: number }[]);
  return { unverified: (((verified?.results[0] ?? {}) as { n?: number }).n ?? 0) === 0, bands, total };
}

function fill(
  bands: { band: string; entries: number; introduced: number; bySkill: Record<Skill, SkillCounts> }[],
  total: { entries: number; introduced: number; bySkill: Record<Skill, SkillCounts> },
  entries: { band: string; n: number }[],
  introduced: { band: string; n: number }[],
  states: { band: string; skill: Skill; state: string; n: number }[],
) {
  const byBand = new Map(bands.map((b) => [b.band as string, b]));
  for (const r of entries) {
    const row = byBand.get(r.band);
    if (row) row.entries = r.n;
    total.entries += r.n;
  }
  for (const r of introduced) {
    const row = byBand.get(r.band);
    if (row) row.introduced = r.n;
    total.introduced += r.n;
  }
  for (const r of states) {
    if (!(MASTERY_STATES as readonly string[]).includes(r.state) || r.state === "unseen") continue;
    const key = r.state as keyof SkillCounts;
    const row = byBand.get(r.band);
    if (row?.bySkill[r.skill]) row.bySkill[r.skill][key] += r.n;
    if (total.bySkill[r.skill]) total.bySkill[r.skill][key] += r.n;
  }
}

async function sections(d1: D1Database): Promise<ProgressSummary["sections"]> {
  const edition = await d1.prepare("SELECT id FROM curriculum_editions WHERE is_active = 1 LIMIT 1").first<{ id: string }>();
  const none = { grammar: null, character: null, topics: { met: 0, imported: 0 }, tasks: { met: 0, imported: 0 } };
  if (!edition) return none;
  const exposure = async (type: "topic" | "task") => {
    const row = await d1
      .prepare(
        `SELECT (SELECT COUNT(*) FROM curriculum_items WHERE edition_id = ?1 AND item_type = ?2) AS imported,
  (SELECT COUNT(DISTINCT si.curriculum_item_id) FROM session_items si JOIN sessions s ON s.id = si.session_id
   WHERE si.item_type = ?2 AND s.status = 'complete') AS met`,
      )
      .bind(edition.id, type)
      .first<{ imported: number; met: number }>();
    return { met: row?.met ?? 0, imported: row?.imported ?? 0 };
  };
  const [grammar, character, topics, tasks] = await Promise.all([
    sectionCoverage(d1, edition.id, "grammar"),
    sectionCoverage(d1, edition.id, "character"),
    exposure("topic"),
    exposure("task"),
  ]);
  return { grammar, character, topics, tasks };
}

async function coverage(d1: D1Database): Promise<ProgressSummary["hsk"]> {
  const edition = await d1.prepare("SELECT id FROM curriculum_editions WHERE is_active = 1 LIMIT 1").first<{ id: string }>();
  const bands = HSK_BANDS.map((band) => ({ band, expectedEntries: VOCAB_NEW_ENTRIES_BY_BAND[band], ...emptyRow() }));
  const total = emptyRow();
  if (!edition) return { editionId: null, synthetic: false, bands, total };

  const [entries, states, introduced] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare("SELECT hsk_band AS band, COUNT(*) AS n FROM curriculum_items WHERE edition_id = ?1 AND item_type = 'vocab' GROUP BY 1")
      .bind(edition.id),
    d1
      .prepare(
        `SELECT ci.hsk_band AS band, ms.skill, ms.state, COUNT(*) AS n
FROM mastery_states ms JOIN curriculum_items ci ON ci.id = ms.curriculum_item_id
WHERE ms.owner_id = ?1 AND ci.edition_id = ?2 AND ci.item_type = 'vocab' AND ms.state <> 'unseen'
GROUP BY 1, 2, 3`,
      )
      .bind(OWNER_ID, edition.id),
    d1
      .prepare(
        `SELECT ci.hsk_band AS band, COUNT(DISTINCT ms.curriculum_item_id) AS n
FROM mastery_states ms JOIN curriculum_items ci ON ci.id = ms.curriculum_item_id
WHERE ms.owner_id = ?1 AND ci.edition_id = ?2 AND ci.item_type = 'vocab' AND ms.state <> 'unseen'
GROUP BY 1`,
      )
      .bind(OWNER_ID, edition.id),
  ]);

  const byBand = new Map(bands.map((b) => [b.band as string, b]));
  for (const r of (entries?.results ?? []) as { band: string; n: number }[]) {
    const row = byBand.get(r.band);
    if (row) row.entries = r.n;
    total.entries += r.n;
  }
  for (const r of (introduced?.results ?? []) as { band: string; n: number }[]) {
    const row = byBand.get(r.band);
    if (row) row.introduced = r.n;
    total.introduced += r.n;
  }
  for (const r of (states?.results ?? []) as { band: string; skill: Skill; state: string; n: number }[]) {
    if (!(MASTERY_STATES as readonly string[]).includes(r.state) || r.state === "unseen") continue;
    const key = r.state as keyof SkillCounts;
    const row = byBand.get(r.band);
    if (row?.bySkill[r.skill]) row.bySkill[r.skill][key] += r.n;
    if (total.bySkill[r.skill]) total.bySkill[r.skill][key] += r.n;
  }
  return { editionId: edition.id, synthetic: getEdition(edition.id)?.synthetic ?? false, bands, total };
}

export async function getProgressSummary(d1: D1Database, days: ProgressWindow, now: Date = new Date()): Promise<ProgressSummary> {
  const { timezone } = await getSettings(d1);
  const dates = windowDates(now, days, timezone);
  const from = dates[0] ?? localStudyDate(now, timezone);
  const to = dates.at(-1) ?? from;
  // Events are counted over the same span as a rolling period ending now.
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();

  const [minutes, sessions, listening, turns, reviews] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare("SELECT local_study_date AS date, SUM(actual_seconds) AS seconds FROM sessions WHERE local_study_date BETWEEN ?1 AND ?2 GROUP BY 1")
      .bind(from, to),
    d1
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE status = 'complete' AND local_study_date BETWEEN ?1 AND ?2")
      .bind(from, to),
    d1
      .prepare(
        `SELECT
  SUM(CASE WHEN revealed_at IS NULL OR answered_at <= revealed_at THEN 1 ELSE 0 END) AS checks,
  SUM(CASE WHEN revealed_at IS NULL OR answered_at <= revealed_at THEN question_count ELSE 0 END) AS questions,
  SUM(CASE WHEN revealed_at IS NULL OR answered_at <= revealed_at THEN correct_count ELSE 0 END) AS correct,
  SUM(CASE WHEN revealed_at IS NOT NULL AND answered_at > revealed_at THEN 1 ELSE 0 END) AS assisted,
  MAX(CASE WHEN revealed_at IS NULL OR answered_at <= revealed_at THEN answered_at END) AS last
FROM listening_exercises WHERE status = 'ready' AND answered_at >= ?1`,
      )
      .bind(since),
    d1
      .prepare(
        `SELECT SUM(CASE WHEN source_mode = 'speech' THEN 1 ELSE 0 END) AS spoken,
  SUM(CASE WHEN source_mode = 'typed' THEN 1 ELSE 0 END) AS typed,
  COUNT(DISTINCT CASE WHEN source_mode = 'speech' THEN session_id END) AS speech_sessions
FROM conversation_turns WHERE status = 'complete' AND created_at >= ?1`,
      )
      .bind(since),
    d1
      .prepare(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN rating <> 'again' THEN 1 ELSE 0 END) AS recalled,
  AVG(CASE rating WHEN 'again' THEN 1 WHEN 'hard' THEN 2 WHEN 'good' THEN 3 WHEN 'easy' THEN 4 END) AS average
FROM review_events WHERE created_at >= ?1`,
      )
      .bind(since),
  ]);

  const perDay = new Map(((minutes?.results ?? []) as { date: string; seconds: number }[]).map((r) => [r.date, r.seconds]));
  const practiceDays = dates.map((date) => ({ date, minutes: Math.round(((perDay.get(date) ?? 0) / 60) * 10) / 10 }));
  const l = (listening?.results[0] ?? {}) as { checks: number | null; questions: number | null; correct: number | null; assisted: number | null; last: string | null };
  const t = (turns?.results[0] ?? {}) as { spoken: number | null; typed: number | null; speech_sessions: number | null };
  const r = (reviews?.results[0] ?? {}) as { n: number; recalled: number | null; average: number | null };
  const checks = l.checks ?? 0;
  const ratings = r.n ?? 0;

  return {
    generatedAt: now.toISOString(),
    timeZone: timezone,
    window: { days, from, to },
    practice: {
      days: practiceDays,
      totalMinutes: Math.round(practiceDays.reduce((sum, d) => sum + d.minutes, 0) * 10) / 10,
      activeDays: practiceDays.filter((d) => d.minutes > 0).length,
      sessionsCompleted: ((sessions?.results[0] ?? {}) as { n?: number }).n ?? 0,
    },
    listening: {
      checks,
      questions: l.questions ?? 0,
      correct: l.correct ?? 0,
      // The sample is the number of checks, each a separate dated assessment.
      accuracy: checks >= MIN_OBSERVATIONS && (l.questions ?? 0) > 0 ? (l.correct ?? 0) / (l.questions ?? 1) : null,
      assistedChecks: l.assisted ?? 0,
      lastCheckedAt: l.last ?? null,
    },
    speaking: { spokenTurns: t.spoken ?? 0, typedTurns: t.typed ?? 0, sessionsWithSpeech: t.speech_sessions ?? 0 },
    reviews: {
      ratings,
      recalled: r.recalled ?? 0,
      recallRate: rateOrNull(r.recalled ?? 0, ratings),
      averageRating: ratings >= MIN_OBSERVATIONS && r.average !== null ? Math.round(r.average * 100) / 100 : null,
    },
    hsk: await coverage(d1),
    sections: await sections(d1),
    skillBalance: await skillBalance(d1, since),
    meaningfulDays: await meaningfulDays(d1, since, timezone, dates),
  };
}

async function skillBalance(d1: D1Database, since: string): Promise<ProgressSummary["skillBalance"]> {
  const rows = await d1
    .prepare("SELECT skill, COUNT(*) AS n, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok FROM practice_attempts WHERE attempted_at >= ?1 GROUP BY skill")
    .bind(since)
    .all<{ skill: string; n: number; ok: number }>();
  return SKILLS.map((skill) => {
    const r = rows.results.find((x) => x.skill === skill);
    return { skill, attempts: r?.n ?? 0, successes: r?.ok ?? 0 };
  });
}

/** Days with something produced (spoken or written) and something retrieved (a review rating). */
async function meaningfulDays(d1: D1Database, since: string, timeZone: string, dates: readonly string[]): Promise<ProgressSummary["meaningfulDays"]> {
  const [produced, retrieved] = await d1.batch<{ at: string }>([
    d1
      .prepare(
        `SELECT attempted_at AS at FROM practice_attempts WHERE attempted_at >= ?1 AND skill IN ('speaking','writing')
UNION ALL SELECT created_at AS at FROM conversation_turns WHERE status = 'complete' AND created_at >= ?1`,
      )
      .bind(since),
    d1.prepare("SELECT created_at AS at FROM review_events WHERE created_at >= ?1").bind(since),
  ]);
  const day = (iso: string) => localStudyDate(new Date(iso), timeZone);
  const p = new Set((produced?.results ?? []).map((r) => day(r.at)));
  const r = new Set((retrieved?.results ?? []).map((x) => day(x.at)));
  const hits = dates.filter((d) => p.has(d) && r.has(d));
  return { count: hits.length, dates: hits };
}

