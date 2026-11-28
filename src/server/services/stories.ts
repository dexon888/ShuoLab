/**
 * Graded stories and dialogues (SPEC §2.6 rule 5, §5.10, FR-036). One is
 * written on request at the learner's band and known words, continuing the
 * last one as a series. Questions come before the translation; reading time
 * is logged as input. Metered with the session's other model calls.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { coverage, coverageTarget, segment } from "../../shared/coverage";
import { isHskBand, type HskBand } from "../../shared/curriculum";
import {
  STORY_FORMAT_NAME,
  STORY_OUTPUT_JSON_SCHEMA,
  storyOutputSchema,
  type Story,
  type StoryKind,
  type StoryOutput,
  type StorySummary,
} from "../../shared/stories";
import { ProviderError, type TutorProvider } from "../providers/types";
import { ApiError } from "../validation/errors";
import { knownWords, vocabularySet } from "./known-words";
import { getSettings } from "./settings";
import { LISTENING_OPERATION, assertWithinBudget, assertWithinRate, recordUsage } from "./usage";

const MAX_ATTEMPTS = 2;

interface Row {
  id: string;
  kind: string;
  hsk_band: string;
  title_zh: string;
  title_en: string;
  episode: number;
  content_json: string;
  coverage_known: number;
  coverage_total: number;
  model: string;
  stand_in: number;
  created_at: string;
  answers_json: string | null;
  correct: number | null;
  answered_at: string | null;
  revealed_at: string | null;
  finished_at: string | null;
  minutes: number;
}

interface Stored {
  lines: { speaker: "A" | "B" | null; zh: string; pinyin: string; en: string }[];
  questions: { questionEn: string; optionsEn: string[]; answerIndex: number }[];
}

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7-9" : `HSK ${band}`;
}

export function buildStoryInstructions(input: {
  kind: StoryKind;
  band: HskBand;
  known: readonly string[];
  previous: { titleZh: string; lastLines: string[] } | null;
  retry: "schema" | "coverage" | null;
  avoid: readonly string[];
}): string {
  const lines = [
    `Write a short graded ${input.kind === "dialogue" ? "dialogue between two people, A and B, taking turns" : "story told by a narrator (speaker null)"} in Mandarin for one adult learner at ${bandName(input.band)}.`,
    "",
    "- 6 to 12 lines, each one or two short sentences, in Simplified Chinese (zh), tone-marked pinyin, and a natural English translation (en).",
    "- Everyday adult life, with a little suspense or humour so it is worth reading. No real people or businesses. Never state an HSK level.",
    input.known.length > 0
      ? `- Build it almost entirely from words the learner knows; use at most a few others, and make their meaning clear from context: ${input.known.slice(0, 300).join("、")}`
      : "- Use only the most basic, everyday words.",
    "- Then 2 or 3 English questions about what happens, each with exactly 3 plausible English options, answer_index 0-2.",
  ];
  if (input.previous) {
    lines.push("", `Continue the previous episode, "${input.previous.titleZh}", which ended: ${input.previous.lastLines.join(" ")}`);
  }
  lines.push("", "Return only the JSON object described by the schema.");
  if (input.retry === "schema") lines.push("", "Your previous answer did not match the schema.");
  if (input.retry === "coverage") lines.push("", `Your previous story used too many words the learner has not met. Rewrite it more simply. Avoid: ${input.avoid.slice(0, 20).join("、")}`);
  return lines.join("\n");
}

function shuffle(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

function toStored(output: StoryOutput, random: () => number): Stored {
  return {
    lines: output.lines.map((l) => ({ speaker: l.speaker, zh: l.zh, pinyin: l.pinyin, en: l.en })),
    questions: output.questions.map((q) => {
      const order = shuffle(q.options_en.length, random);
      return { questionEn: q.question_en, optionsEn: order.map((i) => q.options_en[i] as string), answerIndex: order.indexOf(q.answer_index) };
    }),
  };
}

function summary(row: Row): StorySummary {
  return {
    id: row.id,
    kind: row.kind as StoryKind,
    band: (isHskBand(row.hsk_band) ? row.hsk_band : "1") as HskBand,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    episode: row.episode,
    createdAt: row.created_at,
    coverage: { known: row.coverage_known, total: row.coverage_total },
    finishedAt: row.finished_at,
    minutes: row.minutes,
  };
}

/** Meanings of the syllabus words in the text, each only with its recorded source. */
async function glossary(d1: D1Database, lines: Stored["lines"]): Promise<Story["glossary"]> {
  const vocabulary = await vocabularySet(d1);
  const words = [...new Set(lines.flatMap((l) => segment(l.zh, vocabulary)).filter((w) => vocabulary.has(w)))];
  if (words.length === 0) return {};
  const rows = await d1
    .prepare(
      `SELECT hanzi, pinyin, definition, definition_provenance FROM curriculum_items
WHERE item_type = 'vocab' AND edition_id = (SELECT id FROM curriculum_editions WHERE is_active = 1) AND hanzi IN (SELECT value FROM json_each(?1))
ORDER BY source_id`,
    )
    .bind(JSON.stringify(words))
    .all<{ hanzi: string; pinyin: string | null; definition: string | null; definition_provenance: string | null }>();
  const out: Story["glossary"] = {};
  for (const r of rows.results) {
    if (out[r.hanzi]) continue;
    const sourced = r.definition && r.definition_provenance;
    out[r.hanzi] = { pinyin: r.pinyin, definition: sourced ? r.definition : null, provenance: sourced ? r.definition_provenance : null };
  }
  return out;
}

async function toStory(d1: D1Database, row: Row): Promise<Story> {
  const content = JSON.parse(row.content_json) as Stored;
  const open = row.answered_at !== null || row.revealed_at !== null;
  return {
    ...summary(row),
    standIn: row.stand_in === 1,
    lines: content.lines.map((l) => ({ ...l, pinyin: row.revealed_at ? l.pinyin : "", en: row.revealed_at ? l.en : "" })),
    questions: content.questions.map((q) => ({ questionEn: q.questionEn, optionsEn: q.optionsEn, answerIndex: open ? q.answerIndex : null })),
    answers: row.answers_json ? (JSON.parse(row.answers_json) as number[]) : null,
    correct: row.correct,
    revealed: row.revealed_at !== null,
    unassisted: row.answered_at === null ? null : row.revealed_at === null || row.answered_at <= row.revealed_at,
    glossary: await glossary(d1, content.lines),
  };
}

async function find(d1: D1Database, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError("BAD_REQUEST", "That is not a story id.");
  const row = await d1.prepare("SELECT * FROM stories WHERE id = ?1").bind(id).first<Row>();
  if (!row) throw new ApiError("NOT_FOUND", "No such story.");
  return row;
}

export async function getStory(d1: D1Database, id: string): Promise<Story> {
  return toStory(d1, await find(d1, id));
}

export async function listStories(d1: D1Database, now: Date = new Date()) {
  const rows = await d1.prepare("SELECT * FROM stories ORDER BY created_at DESC LIMIT 30").all<Row>();
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const totals = await d1
    .prepare("SELECT COALESCE(SUM(minutes), 0) AS total, COALESCE(SUM(CASE WHEN finished_at >= ?1 THEN minutes ELSE 0 END), 0) AS week FROM stories")
    .bind(week)
    .first<{ total: number; week: number }>();
  return { stories: rows.results.map(summary), minutesThisWeek: totals?.week ?? 0, minutesTotal: totals?.total ?? 0 };
}

/** Writes a new story or dialogue at the learner's band and known words, continuing the last of its kind. */
export async function createStory(
  d1: D1Database,
  provider: TutorProvider,
  kind: StoryKind,
  continueSeries: boolean,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<Story> {
  const settings = await getSettings(d1);
  const band: HskBand = settings.studyBand ?? "1";
  const [vocabulary, known] = await Promise.all([vocabularySet(d1), knownWords(d1, null)]);
  if (vocabulary.size === 0) throw new ApiError("CURRICULUM_MISSING", "Import the HSK vocabulary first; stories are pitched against it.");
  const last = continueSeries ? await d1.prepare("SELECT * FROM stories WHERE kind = ?1 ORDER BY created_at DESC LIMIT 1").bind(kind).first<Row>() : null;
  const previous = last ? { titleZh: last.title_zh, lastLines: (JSON.parse(last.content_json) as Stored).lines.slice(-2).map((l) => l.zh) } : null;
  const target = provider.mock ? null : coverageTarget(known.set.size);

  await assertWithinRate(d1, now);
  await assertWithinBudget(d1, provider.paid, now);
  let best: { output: StoryOutput; known: number; total: number } | null = null;
  let retry: "schema" | "coverage" | null = null;
  let avoid: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let result;
    try {
      result = await provider.generate({
        instructions: buildStoryInstructions({ kind, band, known: known.recent, previous, retry, avoid }),
        messages: [{ role: "user", content: "Write the next story." }],
        format: { name: STORY_FORMAT_NAME, schema: STORY_OUTPUT_JSON_SCHEMA, maxOutputTokens: 2000, timeoutMs: 30_000 },
        context: { targets: known.recent.slice(0, 8).map((h, i) => ({ id: `known:${i}`, hanzi: h })), colloquial: [], turnIndex: 0, attempt },
      });
    } catch (error) {
      await recordUsage(d1, { provider: provider.vendor, operation: LISTENING_OPERATION, model: provider.model, usage: { tokensIn: 0, tokensOut: 0 }, estimatedUsd: 0, status: "error", sessionId: null }, now);
      throw error instanceof ProviderError ? new ApiError("PROVIDER_UNAVAILABLE", "The tutor could not write a story right now. Try again.", true) : error;
    }
    let output: StoryOutput | null;
    try {
      const parsed = storyOutputSchema.safeParse(JSON.parse(result.text ?? "null"));
      output = parsed.success ? parsed.data : null;
    } catch {
      output = null;
    }
    await recordUsage(
      d1,
      { provider: provider.vendor, operation: LISTENING_OPERATION, model: provider.model, usage: result.usage, estimatedUsd: provider.estimateUsd(result.usage), status: output ? "ok" : "invalid", sessionId: null },
      now,
    );
    if (!output) {
      retry = "schema";
      continue;
    }
    const c = coverage(output.lines.map((l) => l.zh).join(""), vocabulary, known.set);
    best = { output, known: c.known, total: c.total };
    if (target === null || c.total === 0 || c.known / c.total >= target) break;
    retry = "coverage";
    avoid = c.unknown;
  }
  if (!best) throw new ApiError("PROVIDER_UNAVAILABLE", "The tutor's story could not be read. Try again.", true);

  const id = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO stories (id, kind, hsk_band, title_zh, title_en, episode, content_json, coverage_known, coverage_total, model, stand_in, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(id, kind, band, best.output.title_zh, best.output.title_en, last ? last.episode + 1 : 1, JSON.stringify(toStored(best.output, random)), best.known, best.total, provider.model, provider.mock ? 1 : 0, now.toISOString())
    .run();
  return getStory(d1, id);
}

export async function answerStory(d1: D1Database, id: string, answers: readonly number[], now: Date = new Date()): Promise<Story> {
  const row = await find(d1, id);
  const content = JSON.parse(row.content_json) as Stored;
  if (answers.length !== content.questions.length) throw new ApiError("BAD_REQUEST", `Send one answer for each of the ${content.questions.length} questions.`);
  if (row.answered_at === null) {
    const correct = answers.filter((a, i) => a === content.questions[i]?.answerIndex).length;
    await d1
      .prepare("UPDATE stories SET answers_json = ?2, correct = ?3, answered_at = ?4 WHERE id = ?1 AND answered_at IS NULL")
      .bind(id, JSON.stringify(answers), correct, now.toISOString())
      .run();
  }
  return getStory(d1, id);
}

export async function revealStory(d1: D1Database, id: string, now: Date = new Date()): Promise<Story> {
  await find(d1, id);
  await d1.prepare("UPDATE stories SET revealed_at = COALESCE(revealed_at, ?2) WHERE id = ?1").bind(id, now.toISOString()).run();
  return getStory(d1, id);
}

/** Logs reading and listening time; the first finish sets the time, later ones add to it. */
export async function finishStory(d1: D1Database, id: string, minutes: number, now: Date = new Date()): Promise<Story> {
  await find(d1, id);
  await d1
    .prepare("UPDATE stories SET minutes = MIN(minutes + ?2, 600), finished_at = ?3 WHERE id = ?1")
    .bind(id, Math.round(minutes * 10) / 10, now.toISOString())
    .run();
  return getStory(d1, id);
}
