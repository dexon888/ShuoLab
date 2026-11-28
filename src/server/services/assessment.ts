/**
 * Band practice tests and monthly checkpoints (SPEC §6.5, FR-027, FR-022).
 *
 * Built in code from imported items with fixed keys; the same band, kind and
 * day always give the same test. Correct answers count as recall evidence;
 * results are personal tracking, never an HSK score.
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  CHECKPOINT_SIZES,
  PLACEMENT_KNOWN,
  PLACEMENT_PER_BAND,
  PROMOTION_RECALLED,
  PROMOTION_TEST_PASSES,
  PROMOTION_TEST_SCORE,
  type Promotion,
  RUBRIC_VERSION,
  SECTION_SKILL,
  TEST_SIZES,
  type Assessment,
  type AssessmentKind,
  type QuestionKind,
  type TestQuestion,
} from "../../shared/assessment";
import { HSK_BANDS, getEdition, type HskBand } from "../../shared/curriculum";
import type { Skill } from "../../shared/learning";
import { grammarMarkers, usesGrammar, wordsUsed } from "../../shared/lesson";
import { parseItemDetails } from "../../shared/sections";
import { localStudyDate } from "../../shared/session";
import { countHan } from "../../shared/tutor";
import { OWNER_ID } from "../db/schema";
import { ApiError } from "../validation/errors";
import { recomputeMastery } from "./review";
import { getSettings } from "./settings";

// --- Deterministic choice -----------------------------------------------------------

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32), so a test is reproducible. */
export function seeded(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// --- Building a test ------------------------------------------------------------------

export interface WordRow {
  id: string;
  hanzi: string;
  pinyin: string | null;
  /** First sense of a sourced meaning, when one is imported. */
  meaning?: string | null;
}
export interface GrammarRow {
  id: string;
  name: string;
  examples: string[];
  unverified: boolean;
}
export interface CharacterRow {
  id: string;
  hanzi: string;
  unverified: boolean;
}

export interface TestPools {
  words: WordRow[];
  grammar: GrammarRow[];
  characters: CharacterRow[];
  topic: string | null;
  task: string | null;
}

/** A stored question: what is shown, plus its key and the item it is about. */
export interface StoredQuestion extends TestQuestion {
  key: number | null;
  keyText: string;
  itemId: string | null;
  /** Placement: the band the word is from. */
  band?: string;
  /** For written and spoken tasks: the band words that count toward "uses the band's words". */
  words?: string[];
  minChars?: number;
}

function options(correct: string, distractors: readonly string[], random: () => number): { options: string[]; key: number } {
  const set = shuffled([correct, ...distractors.filter((d) => d !== correct).slice(0, 2)], random);
  return { options: set, key: set.indexOf(correct) };
}

/** A reading question on one word: its meaning when sourced meanings exist for it and two others, else its pinyin. */
function wordQuestion(w: WordRow, pool: readonly WordRow[], random: () => number, band?: string): Omit<StoredQuestion, "index"> | null {
  const meanings = shuffled(pool.filter((o) => o.meaning && o.meaning !== w.meaning), random).map((o) => o.meaning as string);
  if (w.meaning && meanings.length >= 2) {
    const o = options(w.meaning, meanings, random);
    return { kind: "word_reading", ask: "Choose the meaning of this word.", prompt: w.hanzi, audio: null, options: o.options, criteria: [], unverifiedKey: false, key: o.key, keyText: w.meaning, itemId: w.id, ...(band ? { band } : {}) };
  }
  if (!w.pinyin) return null;
  const pinyins = shuffled(pool.filter((o) => o.pinyin && o.pinyin !== w.pinyin), random).map((o) => o.pinyin as string);
  if (pinyins.length < 2) return null;
  const o = options(w.pinyin, pinyins, random);
  return { kind: "word_reading", ask: "Choose the pinyin for this word.", prompt: w.hanzi, audio: null, options: o.options, criteria: [], unverifiedKey: false, key: o.key, keyText: w.pinyin, itemId: w.id, ...(band ? { band } : {}) };
}

/**
 * Placement (SPEC §2.6 rule 6): the same number of words from every band,
 * sampled with the seed, so the result reflects the whole syllabus.
 */
export function buildPlacement(bands: readonly { band: string; words: WordRow[] }[], seed: string): StoredQuestion[] {
  const random = seeded(seed);
  const out: StoredQuestion[] = [];
  for (const { band, words } of bands) {
    let n = 0;
    for (const w of shuffled(words, random)) {
      if (n >= PLACEMENT_PER_BAND) break;
      const q = wordQuestion(w, words, random, band);
      if (!q) continue;
      out.push({ ...q, index: out.length });
      n += 1;
    }
  }
  return out;
}

/** Share known in a band, corrected for guessing among three options. */
export function correctedShare(correct: number, total: number): number {
  if (total === 0) return 0;
  const p = correct / total;
  return Math.max(0, Math.min(1, (p - 1 / 3) / (2 / 3)));
}

/**
 * Builds the questions. Pure: the same pools and seed give the same test.
 * Sections a band cannot fill (too few items) are shorter or left out.
 */
export function buildQuestions(pools: TestPools, kind: AssessmentKind, seed: string): StoredQuestion[] {
  const random = seeded(seed);
  const sizes = kind === "checkpoint" ? CHECKPOINT_SIZES : TEST_SIZES;
  const out: StoredQuestion[] = [];
  const push = (q: Omit<StoredQuestion, "index">) => out.push({ ...q, index: out.length });
  const words = shuffled(pools.words.filter((w) => w.hanzi.length > 0), random);
  const withPinyin = words.filter((w) => w.pinyin);

  // Reading: see the word, choose its meaning (SPEC §2.6 rule 7), or its pinyin where no meaning is imported.
  for (const w of withPinyin.slice(0, sizes.word_reading)) {
    const q = wordQuestion(w, words, random);
    if (!q) break;
    push(q);
  }
  // Listening: hear the word, choose it.
  const listenPool = words.slice(sizes.word_reading).length >= sizes.word_listening ? words.slice(sizes.word_reading) : words;
  for (const w of listenPool.slice(0, sizes.word_listening)) {
    const distract = shuffled(words.filter((o) => o.hanzi !== w.hanzi), random).map((o) => o.hanzi);
    if (distract.length < 2) break;
    const o = options(w.hanzi, distract, random);
    push({ kind: "word_listening", ask: "Listen, then choose the word you heard.", prompt: null, audio: w.hanzi, options: o.options, criteria: [], unverifiedKey: false, key: o.key, keyText: w.hanzi, itemId: w.id });
  }
  // Grammar: fill the gap in a syllabus example with the pattern.
  const firstPart = (g: GrammarRow) => grammarMarkers(g.name)[0]?.[0] ?? "";
  const checkable = shuffled(
    pools.grammar.filter((g) => firstPart(g) && g.examples.some((e) => usesGrammar(e, grammarMarkers(g.name)))),
    random,
  );
  for (const g of checkable.slice(0, sizes.grammar_gap)) {
    const markers = grammarMarkers(g.name);
    const example = g.examples.find((e) => usesGrammar(e, markers)) as string;
    const part = markers.flat().find((p) => example.includes(p)) as string;
    const distract = shuffled(checkable.filter((o) => o.id !== g.id).map(firstPart), random).filter((p) => p && !example.includes(p));
    if (distract.length < 2) continue;
    const o = options(part, distract, random);
    push({
      kind: "grammar_gap",
      ask: "Choose what fills the gap.",
      prompt: example.replace(part, "＿＿"),
      audio: null,
      options: o.options,
      criteria: [],
      unverifiedKey: g.unverified,
      key: o.key,
      keyText: part,
      itemId: g.id,
    });
  }
  // Characters: which word contains this character?
  for (const c of shuffled(pools.characters, random)) {
    if (out.filter((q) => q.kind === "character_word").length >= sizes.character_word) break;
    const inWords = words.filter((w) => w.hanzi.includes(c.hanzi));
    const without = words.filter((w) => !w.hanzi.includes(c.hanzi)).map((w) => w.hanzi);
    if (inWords.length === 0 || without.length < 2) continue;
    const word = (inWords[0] as WordRow).hanzi;
    const o = options(word, without, random);
    push({ kind: "character_word", ask: "Which word contains this character?", prompt: c.hanzi, audio: null, options: o.options, criteria: [], unverifiedKey: c.unverified, key: o.key, keyText: word, itemId: c.id });
  }
  const bandWords = words.map((w) => w.hanzi);
  const task = pools.task ?? "Describe your day.";
  if (sizes.writing_task > 0) {
    push({
      kind: "writing_task",
      ask: `Write 2–4 sentences in Chinese for this task: ${task}`,
      prompt: pools.topic,
      audio: null,
      options: [],
      criteria: ["At least 20 Chinese characters", "Uses at least 2 words of this band"],
      unverifiedKey: false,
      key: null,
      keyText: "At least 20 Chinese characters and 2 words of this band",
      itemId: null,
      words: bandWords,
      minChars: 20,
    });
  }
  if (sizes.speaking_task > 0) {
    push({
      kind: "speaking_task",
      ask: `Answer aloud, without preparing, for this task: ${task}`,
      prompt: pools.topic,
      audio: null,
      options: [],
      criteria: ["At least 15 Chinese characters said", "Uses at least 1 word of this band"],
      unverifiedKey: false,
      key: null,
      keyText: "At least 15 Chinese characters and 1 word of this band",
      itemId: null,
      words: bandWords,
      minChars: 15,
    });
  }
  return out;
}

/** Scores one answer by its fixed key or criteria. */
export function scoreAnswer(q: StoredQuestion, answer: number | string | null): boolean {
  if (q.key !== null) return answer === q.key;
  if (typeof answer !== "string") return false;
  const need = q.kind === "speaking_task" ? 1 : 2;
  return countHan(answer) >= (q.minChars ?? 20) && wordsUsed(answer, q.words ?? []).length >= need;
}

// --- Storage and API ------------------------------------------------------------------------

interface RunRow {
  id: string;
  edition_id: string;
  kind: string;
  hsk_band: string;
  rubric_version: string;
  started_at: string;
  finished_at: string | null;
  metadata_json: string;
  results_json: string | null;
}

interface Metadata {
  frame: { topic: string | null; task: string | null };
  questions: StoredQuestion[];
}

function toAssessment(row: RunRow): Assessment {
  const meta = JSON.parse(row.metadata_json) as Metadata;
  const results = row.results_json ? (JSON.parse(row.results_json) as Assessment["results"]) : null;
  return {
    id: row.id,
    kind: row.kind as AssessmentKind,
    hskBand: row.hsk_band as HskBand,
    editionId: row.edition_id,
    synthetic: getEdition(row.edition_id)?.synthetic ?? false,
    rubricVersion: row.rubric_version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    frame: meta.frame,
    questions: meta.questions.map((q) => ({
      index: q.index,
      kind: q.kind,
      ask: q.ask,
      prompt: q.prompt,
      audio: q.audio,
      options: q.options,
      criteria: q.criteria,
      unverifiedKey: q.unverifiedKey,
    })),
    results,
  };
}

async function activeEdition(d1: D1Database): Promise<string> {
  const row = await d1.prepare("SELECT id FROM curriculum_editions WHERE is_active = 1 LIMIT 1").first<{ id: string }>();
  if (!row) throw new ApiError("CURRICULUM_MISSING", "Import the HSK vocabulary first; tests are built from it.");
  return row.id;
}

/** The first sense of a sourced meaning, or null. */
const MEANING_SQL = `CASE WHEN ci.definition IS NOT NULL AND ci.definition_provenance IS NOT NULL
  THEN trim(substr(ci.definition, 1, CASE WHEN instr(ci.definition, ';') > 0 THEN instr(ci.definition, ';') - 1 ELSE 60 END)) END AS meaning`;

async function pools(d1: D1Database, editionId: string, band: HskBand, kind: AssessmentKind): Promise<TestPools> {
  // The whole band, shuffled by the seed in buildQuestions (SPEC §2.6 rule 7), not the start of its alphabetical list.
  // A checkpoint asks about words never met in a session, so it measures unseen material.
  const unseenOnly =
    kind === "checkpoint"
      ? "AND ci.id NOT IN (SELECT curriculum_item_id FROM session_targets) AND ci.id NOT IN (SELECT curriculum_item_id FROM mastery_states)"
      : "";
  const [words, sections, verified] = await d1.batch<Record<string, unknown>>([
    d1
      .prepare(`SELECT ci.id, ci.hanzi, ci.pinyin, ${MEANING_SQL} FROM curriculum_items ci WHERE ci.edition_id = ?1 AND ci.item_type = 'vocab' AND ci.hsk_band = ?2 ${unseenOnly} ORDER BY ci.source_id`)
      .bind(editionId, band),
    d1
      .prepare(
        `SELECT id, item_type, hanzi, metadata_json FROM curriculum_items
WHERE edition_id = ?1 AND hsk_band = ?2 AND item_type IN ('grammar','character','topic','task')
  AND id NOT IN (SELECT curriculum_item_id FROM item_flags) ORDER BY source_id`,
      )
      .bind(editionId, band),
    d1.prepare("SELECT DISTINCT dataset_kind AS k FROM source_manifests WHERE edition_id = ?1 AND verification_status = 'verified'").bind(editionId),
  ]);
  const ok = new Set(((verified?.results ?? []) as { k: string }[]).map((r) => r.k));
  const grammar: GrammarRow[] = [];
  const characters: CharacterRow[] = [];
  const topics: string[] = [];
  const tasks: string[] = [];
  for (const r of (sections?.results ?? []) as { id: string; item_type: string; hanzi: string; metadata_json: string | null }[]) {
    const d = parseItemDetails(r.item_type as "grammar", r.metadata_json);
    if (d?.kind === "grammar") grammar.push({ id: r.id, name: r.hanzi, examples: d.examples, unverified: !ok.has("grammar") });
    if (d?.kind === "character") characters.push({ id: r.id, hanzi: r.hanzi, unverified: !ok.has("character") });
    if (d?.kind === "topic") topics.push(`${d.area} · ${d.subject}`);
    if (d?.kind === "task") tasks.push(d.canDo);
  }
  return { words: (words?.results ?? []) as unknown as WordRow[], grammar, characters, topic: topics[0] ?? null, task: tasks[0] ?? null };
}

export async function listAssessments(d1: D1Database, now: Date = new Date()) {
  const rows = await d1.prepare("SELECT * FROM assessment_runs ORDER BY started_at DESC LIMIT 20").all<RunRow>();
  const month = now.toISOString().slice(0, 7);
  const checkpoint = await d1.prepare("SELECT 1 AS x FROM assessment_runs WHERE kind = 'checkpoint' AND substr(started_at, 1, 7) = ?1 LIMIT 1").bind(month).first();
  return {
    runs: rows.results.map((r) => {
      const a = toAssessment(r);
      const { questions: _questions, ...rest } = a;
      void _questions;
      return rest;
    }),
    checkpointDue: !checkpoint,
  };
}

export async function getAssessment(d1: D1Database, id: string): Promise<Assessment> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError("BAD_REQUEST", "That is not a test id.");
  const row = await d1.prepare("SELECT * FROM assessment_runs WHERE id = ?1").bind(id).first<RunRow>();
  if (!row) throw new ApiError("NOT_FOUND", "No such test.");
  return toAssessment(row);
}

/** Starts a test for the band. A checkpoint is once a calendar month. */
export async function startAssessment(d1: D1Database, band: HskBand, kind: AssessmentKind, now: Date = new Date()): Promise<Assessment> {
  const editionId = await activeEdition(d1);
  if (kind === "checkpoint" && !(await listAssessments(d1, now)).checkpointDue) {
    throw new ApiError("CONFLICT", "This month's checkpoint is done. The next one opens next month.");
  }
  const { timezone } = await getSettings(d1);
  const seed = `${editionId}:${band}:${kind}:${localStudyDate(now, timezone)}`;
  if (kind === "placement") {
    const bands = await Promise.all(
      HSK_BANDS.map(async (b) => ({
        band: b,
        words: (
          await d1
            .prepare(`SELECT ci.id, ci.hanzi, ci.pinyin, ${MEANING_SQL} FROM curriculum_items ci WHERE ci.edition_id = ?1 AND ci.item_type = 'vocab' AND ci.hsk_band = ?2 ORDER BY ci.source_id`)
            .bind(editionId, b)
            .all<WordRow>()
        ).results,
      })),
    );
    const questions = buildPlacement(bands, seed);
    if (questions.length < 3) throw new ApiError("CURRICULUM_MISSING", "Too few imported words to build a placement test.");
    const id = crypto.randomUUID();
    await d1
      .prepare("INSERT INTO assessment_runs (id, owner_id, edition_id, kind, hsk_band, rubric_version, started_at, metadata_json) VALUES (?1, ?2, ?3, 'placement', '1', ?4, ?5, ?6)")
      .bind(id, OWNER_ID, editionId, RUBRIC_VERSION, now.toISOString(), JSON.stringify({ frame: { topic: null, task: null }, questions }))
      .run();
    return getAssessment(d1, id);
  }
  const p = await pools(d1, editionId, band, kind);
  const questions = buildQuestions(p, kind, seed);
  if (questions.filter((q) => q.key !== null).length < 3) {
    throw new ApiError("CURRICULUM_MISSING", "This band has too few imported items to build a test.");
  }
  const id = crypto.randomUUID();
  const meta: Metadata = { frame: { topic: p.topic, task: p.task }, questions };
  await d1
    .prepare(
      "INSERT INTO assessment_runs (id, owner_id, edition_id, kind, hsk_band, rubric_version, started_at, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(id, OWNER_ID, editionId, kind, band, RUBRIC_VERSION, now.toISOString(), JSON.stringify(meta))
    .run();
  return getAssessment(d1, id);
}

/**
 * Scores the answers once. Correct and incorrect answers about an item are
 * recall evidence for it (SPEC §6.5); a typed answer to a spoken task is
 * recorded as writing, never speaking.
 */
export async function finishAssessment(
  d1: D1Database,
  id: string,
  answers: readonly (number | string | null)[],
  spoken: readonly boolean[],
  now: Date = new Date(),
): Promise<Assessment> {
  const row = await d1.prepare("SELECT * FROM assessment_runs WHERE id = ?1").bind(id).first<RunRow>();
  if (!row) throw new ApiError("NOT_FOUND", "No such test.");
  if (row.finished_at) return toAssessment(row);
  const meta = JSON.parse(row.metadata_json) as Metadata;
  if (answers.length !== meta.questions.length) throw new ApiError("BAD_REQUEST", `Send one answer for each of the ${meta.questions.length} questions (null to skip).`);

  const results = meta.questions.map((q, i) => ({ index: q.index, correct: scoreAnswer(q, answers[i] ?? null), key: q.keyText, answer: answers[i] === null || answers[i] === undefined ? null : String(answers[i]) }));
  const sections = (Object.keys(SECTION_SKILL) as QuestionKind[])
    .map((kind) => {
      const qs = meta.questions.filter((q) => q.kind === kind);
      return { kind, skill: SECTION_SKILL[kind], correct: qs.filter((q) => results[q.index]?.correct).length, total: qs.length };
    })
    .filter((s) => s.total > 0);
  const at = now.toISOString();
  if (row.kind === "placement") {
    const sizes = new Map(
      (await d1.prepare("SELECT hsk_band AS band, COUNT(*) AS n FROM curriculum_items WHERE edition_id = ?1 AND item_type = 'vocab' GROUP BY 1").bind(row.edition_id).all<{ band: string; n: number }>()).results.map((r) => [r.band, r.n]),
    );
    const bands = HSK_BANDS.map((b) => {
      const qs = meta.questions.filter((q) => q.band === b);
      const correct = qs.filter((q) => results[q.index]?.correct).length;
      return { band: b, correct, total: qs.length, known: Math.round(correctedShare(correct, qs.length) * 100) / 100, bandSize: sizes.get(b) ?? 0 };
    });
    const estimatedWords = Math.round(bands.reduce((n, b) => n + b.known * b.bandSize, 0));
    const suggestedBand = bands.find((b) => b.total > 0 && b.known < PLACEMENT_KNOWN)?.band ?? "7-9";
    const placement = { bands, estimatedWords, sampleSize: meta.questions.length, suggestedBand };
    await d1
      .prepare("UPDATE assessment_runs SET finished_at = ?2, results_json = ?3 WHERE id = ?1 AND finished_at IS NULL")
      .bind(id, at, JSON.stringify({ sections: [], questions: results, correct: results.filter((r) => r.correct).length, total: results.length, placement }))
      .run();
    // Guesses on a placement test are not recall evidence; nothing is recorded per word.
    return getAssessment(d1, id);
  }
  const statements = [
    d1
      .prepare("UPDATE assessment_runs SET finished_at = ?2, results_json = ?3 WHERE id = ?1 AND finished_at IS NULL")
      .bind(id, at, JSON.stringify({ sections, questions: results, correct: results.filter((r) => r.correct).length, total: results.length })),
  ];
  const touched: { itemId: string; skill: Skill }[] = [];
  const attempt = (itemId: string, skill: Skill, answer: string | null, success: boolean) => {
    touched.push({ itemId, skill });
    statements.push(
      d1
        .prepare(
          `INSERT INTO practice_attempts (id, session_id, curriculum_item_id, skill, assessment_type, prompt_id, user_response, score, score_source, is_qualifying_recall, success, attempted_at)
VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 'rubric', 1, ?8, ?9)`,
        )
        .bind(crypto.randomUUID(), itemId, skill, row.kind, `${row.kind}:${id}`, answer, success ? 1 : 0, success ? 1 : 0, at),
    );
  };
  const wordIds = new Map((await d1.prepare("SELECT id, hanzi FROM curriculum_items WHERE edition_id = ?1 AND item_type = 'vocab' AND hsk_band = ?2").bind(row.edition_id, row.hsk_band).all<{ id: string; hanzi: string }>()).results.map((w) => [w.hanzi, w.id]));
  for (const q of meta.questions) {
    const r = results[q.index];
    if (!r || r.answer === null) continue;
    if (q.itemId) attempt(q.itemId, SECTION_SKILL[q.kind], r.answer, r.correct);
    if (q.kind === "writing_task" || q.kind === "speaking_task") {
      const skill: Skill = q.kind === "speaking_task" && spoken[q.index] === true ? "speaking" : "writing";
      for (const w of wordsUsed(r.answer, q.words ?? [])) {
        const wid = wordIds.get(w);
        if (wid) attempt(wid, skill, r.answer, true);
      }
    }
  }
  await d1.batch(statements);
  const { timezone } = await getSettings(d1);
  for (const t of touched) await recomputeMastery(d1, t.itemId, t.skill, timezone, now);
  return getAssessment(d1, id);
}


/** SPEC §2.6 rule 6: suggest the next band once most of this one is recalled and its test is passed twice. */
export async function promotionFor(d1: D1Database, band: HskBand): Promise<Promotion> {
  const editionId = await activeEdition(d1);
  const next = HSK_BANDS[HSK_BANDS.indexOf(band) + 1] ?? null;
  const counts = await d1
    .prepare(
      `SELECT COUNT(*) AS size,
  (SELECT COUNT(DISTINCT ms.curriculum_item_id) FROM mastery_states ms JOIN curriculum_items c2 ON c2.id = ms.curriculum_item_id
   WHERE c2.edition_id = ?1 AND c2.item_type = 'vocab' AND c2.hsk_band = ?2 AND ms.skill = 'reading' AND ms.state IN ('developing','mastered')) AS recalled
FROM curriculum_items WHERE edition_id = ?1 AND item_type = 'vocab' AND hsk_band = ?2`,
    )
    .bind(editionId, band)
    .first<{ size: number; recalled: number }>();
  const runs = await d1
    .prepare("SELECT results_json FROM assessment_runs WHERE kind = 'band_test' AND hsk_band = ?1 AND finished_at IS NOT NULL")
    .bind(band)
    .all<{ results_json: string }>();
  const testPasses = runs.results.filter((r) => {
    const res = JSON.parse(r.results_json) as { correct: number; total: number };
    return res.total > 0 && res.correct / res.total >= PROMOTION_TEST_SCORE;
  }).length;
  const bandSize = counts?.size ?? 0;
  const recalled = counts?.recalled ?? 0;
  return { band, next, bandSize, recalled, testPasses, ready: next !== null && bandSize > 0 && recalled / bandSize >= PROMOTION_RECALLED && testPasses >= PROMOTION_TEST_PASSES };
}
