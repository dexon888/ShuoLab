/**
 * What the learner has met (SPEC §2.6 rule 4): every word a live session
 * targeted (stretch excepted) or that has any evidence. Used to pitch the
 * tutor's replies and generated texts, and to measure their coverage.
 */
import type { D1Database } from "@cloudflare/workers-types";

const vocabularyCache = new Map<string, Set<string>>();

/** Every vocabulary written form of the active edition, for segmentation. Cached per edition. */
export async function vocabularySet(d1: D1Database): Promise<Set<string>> {
  const edition = await d1.prepare("SELECT id FROM curriculum_editions WHERE is_active = 1 LIMIT 1").first<{ id: string }>();
  if (!edition) return new Set();
  const cached = vocabularyCache.get(edition.id);
  if (cached) return cached;
  const rows = await d1.prepare("SELECT DISTINCT hanzi FROM curriculum_items WHERE edition_id = ?1 AND item_type = 'vocab'").bind(edition.id).all<{ hanzi: string }>();
  const set = new Set(rows.results.map((r) => r.hanzi));
  if (set.size > 0) vocabularyCache.set(edition.id, set);
  return set;
}

export interface KnownWords {
  set: Set<string>;
  /** Most recently met first, for the tutor's instructions. */
  recent: string[];
}

/** Words met in live sessions or with evidence, plus the current session's own words. */
export async function knownWords(d1: D1Database, sessionId: string | null): Promise<KnownWords> {
  const rows = await d1
    .prepare(
      `SELECT ci.hanzi, MAX(at) AS at FROM (
  SELECT st.curriculum_item_id AS id, s.created_at AS at FROM session_targets st JOIN sessions s ON s.id = st.session_id
  WHERE st.role <> 'stretch' AND (s.status <> 'abandoned' OR s.id = ?1)
  UNION ALL
  SELECT curriculum_item_id AS id, updated_at AS at FROM mastery_states WHERE state <> 'unseen'
) m JOIN curriculum_items ci ON ci.id = m.id
WHERE ci.item_type = 'vocab'
GROUP BY ci.hanzi ORDER BY MAX(at) DESC`,
    )
    .bind(sessionId ?? "")
    .all<{ hanzi: string }>();
  const recent = rows.results.map((r) => r.hanzi);
  return { set: new Set(recent), recent };
}

/** Mean length, in Chinese characters, of the learner's recent turns. */
export function meanLearnerChars(texts: readonly string[]): number {
  const recent = texts.slice(-10);
  if (recent.length === 0) return 0;
  const han = (t: string) => [...t].filter((c) => /\p{Script=Han}/u.test(c)).length;
  return recent.reduce((n, t) => n + han(t), 0) / recent.length;
}
