/**
 * Reads what the planner needs beyond the words (SPEC §6.2): recent misses,
 * grammar to recycle or introduce, the band's characters, topics and tasks,
 * and the weakest skill. Everything comes from the database; nothing is
 * invented.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { HSK_BANDS, isHskBand, type HskBand } from "../../shared/curriculum";
import { SKILLS, type Skill } from "../../shared/learning";
import { isCheckableGrammar, type PlanTask, type PlanTopic } from "../../shared/lesson";
import { parseItemDetails } from "../../shared/sections";
import type { CandidateItem, CharacterCandidate, GrammarCandidate } from "./planner";
import { correctedItemIds } from "./review";

const DAY_MS = 86_400_000;

/** Dates as YYYY-MM-DD, `days` before `date`. */
export function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** True when no verified manifest backs this section (SPEC §2.5 rule 1). */
async function unverifiedKinds(d1: D1Database, editionId: string): Promise<Set<string>> {
  const rows = await d1
    .prepare("SELECT DISTINCT dataset_kind AS k FROM source_manifests WHERE edition_id = ?1 AND verification_status = 'verified'")
    .bind(editionId)
    .all<{ k: string }>();
  const verified = new Set(rows.results.map((r) => r.k));
  return new Set(["grammar", "character", "topic", "task"].filter((k) => !verified.has(k)));
}

interface ItemRow {
  id: string;
  source_id: number;
  hsk_band: string;
  hanzi: string;
  pinyin: string | null;
}

function toCandidate(row: ItemRow): CandidateItem | null {
  return isHskBand(row.hsk_band) ? { id: row.id, sourceId: row.source_id, hskBand: row.hsk_band, hanzi: row.hanzi, pinyin: row.pinyin } : null;
}

/**
 * Items corrected in the last three finished sessions (SPEC §2.5 rule 7):
 * their words come first in the next plan, and their grammar is recycled first.
 */
export async function correctedItems(d1: D1Database, editionId: string): Promise<{ words: CandidateItem[]; grammarIds: string[] }> {
  const recent = await d1.prepare("SELECT id FROM sessions WHERE status = 'complete' ORDER BY ended_at DESC LIMIT 3").all<{ id: string }>();
  const ids = await correctedItemIds(d1, recent.results.map((r) => r.id));
  if (ids.length === 0) return { words: [], grammarIds: [] };
  const rows = await d1
    .prepare(
      `SELECT id, source_id, hsk_band, hanzi, pinyin, item_type FROM curriculum_items
WHERE edition_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(editionId, JSON.stringify(ids))
    .all<ItemRow & { item_type: string }>();
  return {
    words: rows.results.filter((r) => r.item_type === "vocab").map(toCandidate).filter((c): c is CandidateItem => c !== null),
    grammarIds: rows.results.filter((r) => r.item_type === "grammar").map((r) => r.id),
  };
}

/** Words rated Again in the last 7 days, most recent first (priority a). */
export async function missedWords(d1: D1Database, editionId: string, now: Date): Promise<CandidateItem[]> {
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const rows = await d1
    .prepare(
      `SELECT ci.id, ci.source_id, ci.hsk_band, ci.hanzi, ci.pinyin
FROM review_events re
JOIN review_cards rc ON rc.id = re.review_card_id
JOIN curriculum_items ci ON ci.id = rc.curriculum_item_id
WHERE ci.edition_id = ?1 AND ci.item_type = 'vocab' AND re.rating = 'again' AND re.created_at >= ?2
GROUP BY ci.id
ORDER BY MAX(re.created_at) DESC
LIMIT 3`,
    )
    .bind(editionId, since)
    .all<ItemRow>();
  return rows.results.map(toCandidate).filter((c): c is CandidateItem => c !== null);
}

/** Every grammar row of the edition with its details, for picking. */
async function grammarRows(d1: D1Database, editionId: string, band: HskBand) {
  const rows = await d1
    .prepare(
      `SELECT id, source_id, hsk_band, hanzi, metadata_json FROM curriculum_items
WHERE edition_id = ?1 AND item_type = 'grammar' AND hsk_band = ?2 ORDER BY source_id`,
    )
    .bind(editionId, band)
    .all<{ id: string; source_id: number; hsk_band: string; hanzi: string; metadata_json: string | null }>();
  return rows.results;
}

/**
 * Grammar for the planner: points never targeted, in syllabus order, and
 * points targeted at least two days ago and not yet mastered in every
 * skill, longest-ago first. Only points whose pattern can be checked in text.
 */
export async function grammarCandidates(
  d1: D1Database,
  editionId: string,
  band: HskBand,
  date: string,
  /** Corrected points come back first, whenever they were last met. */
  corrected: readonly string[] = [],
): Promise<{ fresh: GrammarCandidate[]; recycled: GrammarCandidate[] }> {
  const unverified = (await unverifiedKinds(d1, editionId)).has("grammar");
  const rows = await grammarRows(d1, editionId, band);
  const history = await d1
    .prepare(
      `SELECT si.curriculum_item_id AS id, MAX(s.local_study_date) AS last
FROM session_items si JOIN sessions s ON s.id = si.session_id
WHERE si.item_type = 'grammar' AND s.status <> 'abandoned'
GROUP BY si.curriculum_item_id`,
    )
    .all<{ id: string; last: string }>();
  const last = new Map(history.results.map((h) => [h.id, h.last]));
  const mastered = await d1
    .prepare(
      `SELECT curriculum_item_id AS id FROM mastery_states WHERE state = 'mastered'
GROUP BY curriculum_item_id HAVING COUNT(DISTINCT skill) >= 4`,
    )
    .all<{ id: string }>();
  const done = new Set(mastered.results.map((m) => m.id));

  const fresh: GrammarCandidate[] = [];
  const recycled: (GrammarCandidate & { last: string })[] = [];
  const recycleBefore = daysBefore(date, 2);
  for (const row of rows) {
    if (!isHskBand(row.hsk_band)) continue;
    const details = parseItemDetails("grammar", row.metadata_json);
    if (details?.kind !== "grammar") continue;
    if (!isCheckableGrammar(row.hanzi, details.examples)) continue;
    const example = details.examples.find((e) => isCheckableGrammar(row.hanzi, [e])) ?? null;
    const candidate: GrammarCandidate = {
      itemId: row.id,
      sourceId: row.source_id,
      hskBand: row.hsk_band,
      name: row.hanzi,
      grammarType: details.grammarType,
      example,
      unverified,
    };
    const seen = last.get(row.id);
    if (seen === undefined) fresh.push(candidate);
    else if (corrected.includes(row.id)) recycled.push({ ...candidate, last: "" });
    else if (seen <= recycleBefore && !done.has(row.id)) recycled.push({ ...candidate, last: seen });
  }
  recycled.sort((a, b) => a.last.localeCompare(b.last) || a.sourceId - b.sourceId);
  return { fresh, recycled: recycled.map((g) => ({ itemId: g.itemId, sourceId: g.sourceId, hskBand: g.hskBand, name: g.name, grammarType: g.grammarType, example: g.example, unverified: g.unverified })) };
}

/** Characters on the lists of the study band and every band below it. */
export async function characterLists(d1: D1Database, editionId: string, band: HskBand): Promise<CharacterCandidate[]> {
  const unverified = (await unverifiedKinds(d1, editionId)).has("character");
  const bands = HSK_BANDS.slice(0, HSK_BANDS.indexOf(band) + 1);
  const rows = await d1
    .prepare(
      `SELECT id, hanzi, metadata_json FROM curriculum_items
WHERE edition_id = ?1 AND item_type = 'character' AND hsk_band IN (SELECT value FROM json_each(?2))`,
    )
    .bind(editionId, JSON.stringify(bands))
    .all<{ id: string; hanzi: string; metadata_json: string | null }>();
  return rows.results.flatMap((r) => {
    const d = parseItemDetails("character", r.metadata_json);
    return d?.kind === "character" ? [{ itemId: r.id, hanzi: r.hanzi, skill: d.skill, unverified }] : [];
  });
}

/** Words of earlier live sessions, most recent first. */
export async function metWords(d1: D1Database, editionId: string): Promise<string[]> {
  const rows = await d1
    .prepare(
      `SELECT ci.hanzi FROM session_targets st JOIN sessions s ON s.id = st.session_id JOIN curriculum_items ci ON ci.id = st.curriculum_item_id
WHERE s.status <> 'abandoned' AND ci.edition_id = ?1 AND st.role <> 'stretch'
GROUP BY ci.id ORDER BY MAX(s.created_at) DESC LIMIT 40`,
    )
    .bind(editionId)
    .all<{ hanzi: string }>();
  return rows.results.map((r) => r.hanzi);
}

/** Topic and task ids used by the last `n` live sessions. */
async function recentlyUsed(d1: D1Database, type: "topic" | "task", n: number): Promise<Set<string>> {
  const rows = await d1
    .prepare(
      `SELECT si.curriculum_item_id AS id FROM session_items si
WHERE si.item_type = ?1 AND si.session_id IN (
  SELECT id FROM sessions WHERE status <> 'abandoned' ORDER BY created_at DESC LIMIT ?2)`,
    )
    .bind(type, n)
    .all<{ id: string }>();
  return new Set(rows.results.map((r) => r.id));
}

/** Topics in which the given words were first targeted, so recycled words change topic. */
export async function introTopics(d1: D1Database, itemIds: readonly string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await d1
    .prepare(
      `SELECT si.curriculum_item_id AS id FROM session_items si
WHERE si.item_type = 'topic' AND si.session_id IN (
  SELECT st.session_id FROM session_targets st JOIN sessions s ON s.id = st.session_id
  WHERE st.curriculum_item_id IN (SELECT value FROM json_each(?1)) AND s.status <> 'abandoned')`,
    )
    .bind(JSON.stringify(itemIds))
    .all<{ id: string }>();
  return new Set(rows.results.map((r) => r.id));
}

/**
 * Topics and tasks of the study band, best first: not used in the last three
 * sessions (topics also not where the recycled words began), then rotating
 * through the rest so every one comes round.
 */
export async function topicsAndTasks(
  d1: D1Database,
  editionId: string,
  band: HskBand,
  sessionIndex: number,
  avoidTopics: ReadonlySet<string>,
): Promise<{ topics: PlanTopic[]; tasks: PlanTask[] }> {
  const unverified = await unverifiedKinds(d1, editionId);
  const rows = await d1
    .prepare(
      `SELECT id, item_type, metadata_json FROM curriculum_items
WHERE edition_id = ?1 AND item_type IN ('topic','task') AND hsk_band = ?2 ORDER BY source_id`,
    )
    .bind(editionId, band)
    .all<{ id: string; item_type: "topic" | "task"; metadata_json: string | null }>();
  const [recentTopics, recentTasks] = await Promise.all([recentlyUsed(d1, "topic", 3), recentlyUsed(d1, "task", 3)]);

  const rotate = <T>(list: T[]): T[] => (list.length === 0 ? list : [...list.slice(sessionIndex % list.length), ...list.slice(0, sessionIndex % list.length)]);
  const topics: PlanTopic[] = [];
  const tasks: PlanTask[] = [];
  for (const row of rows.results) {
    const d = parseItemDetails(row.item_type, row.metadata_json);
    if (d?.kind === "topic") topics.push({ itemId: row.id, area: d.area, subject: d.subject, details: d.details, unverified: unverified.has("topic") });
    if (d?.kind === "task") tasks.push({ itemId: row.id, task: d.task, canDo: d.canDo, unverified: unverified.has("task") });
  }
  const rank = <T extends { itemId: string }>(list: T[], avoid: (id: string) => boolean): T[] => {
    const rotated = rotate(list);
    return [...rotated.filter((x) => !avoid(x.itemId)), ...rotated.filter((x) => avoid(x.itemId))];
  };
  return {
    topics: rank(topics, (id) => recentTopics.has(id) || avoidTopics.has(id)),
    tasks: rank(tasks, (id) => recentTasks.has(id)),
  };
}

/** Successful and total qualifying attempts per skill over the last 14 days. */
export async function skillStats(d1: D1Database, now: Date): Promise<{ skill: Skill; attempts: number; successes: number }[]> {
  const since = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const rows = await d1
    .prepare(
      `SELECT skill, COUNT(*) AS n, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok
FROM practice_attempts WHERE attempted_at >= ?1 GROUP BY skill`,
    )
    .bind(since)
    .all<{ skill: string; n: number; ok: number }>();
  return SKILLS.map((skill) => {
    const r = rows.results.find((x) => x.skill === skill);
    return { skill, attempts: r?.n ?? 0, successes: r?.ok ?? 0 };
  });
}
