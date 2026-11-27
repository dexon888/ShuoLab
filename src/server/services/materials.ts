/**
 * Reading, guided practice and writing for a session (SPEC §5.3 steps 4, 5,
 * 7). Written once by the tutor model from the saved plan, checked against
 * the plan's grammar and words, and kept. Answers are checked by fixed
 * criteria in code, never by the model, and recorded as practice attempts.
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  MATERIALS_FORMAT_NAME,
  MATERIALS_OUTPUT_JSON_SCHEMA,
  grammarMarkers,
  materialsOutputSchema,
  usesGrammar,
  wordsUsed,
  type AttemptResult,
  type LessonMaterials,
  type MaterialsOutput,
  type MaterialsResponse,
  type WritingCriterion,
} from "../../shared/lesson";
import type { SessionDetail, SessionPlan } from "../../shared/session";
import { countHan } from "../../shared/tutor";
import { ProviderError, type TutorProvider } from "../providers/types";
import { ApiError } from "../validation/errors";
import { accrueSql, getSession } from "./sessions";
import { coverage, coverageTarget } from "../../shared/coverage";
import { knownWords, vocabularySet } from "./known-words";
import { LISTENING_OPERATION, assertWithinBudget, assertWithinRate, recordUsage } from "./usage";

const MAX_ATTEMPTS = 2;
const MAX_OUTPUT_TOKENS = 1600;
const TIMEOUT_MS = 25_000;
const PENDING_STALE_MS = 60_000;

interface Row {
  session_id: string;
  status: string;
  source: string | null;
  model: string | null;
  stand_in: number;
  covers_targets: number;
  content_json: string | null;
  reading_answers_json: string | null;
  reading_correct: number | null;
  reading_answered_at: string | null;
  reading_revealed_at: string | null;
  practice_json: string | null;
  writing_json: string | null;
  created_at: string;
}

/** What is stored: the checked output, with reading answers shuffled. */
interface Stored {
  reading: { lines: { zh: string; pinyin: string; en: string }[]; questions: { questionEn: string; optionsEn: string[]; answerIndex: number }[] };
  practice: { grammarId: string | null; promptZh: string; promptEn: string; modelAnswerZh: string }[];
  writing: { promptZh: string; promptEn: string };
}

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7-9" : `HSK ${band}`;
}

/** The words the session targets (not stretch). */
function words(plan: SessionPlan): string[] {
  return plan.targets.filter((t) => t.role !== "stretch").map((t) => t.hanzi);
}

// --- Instructions and checks ---------------------------------------------------------

export type MaterialsRejection = "no_output" | "not_json" | "schema" | "coverage";

const RETRY: Readonly<Record<MaterialsRejection, string>> = {
  no_output: "Your previous answer was empty. Write the materials.",
  not_json: "Your previous answer was not valid JSON. Return only the JSON object.",
  schema: "Your previous answer did not match the required fields. Follow the schema exactly.",
  coverage:
    "Your previous answer did not use every grammar pattern and enough of the words. The reading must contain each grammar pattern and at least two of the words; every practice model answer must use its pattern.",
};

export function buildMaterialsInstructions(plan: SessionPlan, retry: MaterialsRejection | null, known: readonly string[] = []): string {
  const lines = [
    "Write short practice materials in Mandarin for one adult learner.",
    "",
    plan.topic ? `Topic: ${plan.topic.area} · ${plan.topic.subject} (${plan.topic.details}).` : `Situation: ${plan.situation.titleZh} / ${plan.situation.titleEn}.`,
    plan.task ? `Task the learner is practising: ${plan.task.canDo}` : `Goal: ${plan.situation.communicativeGoal}`,
  ];
  if (plan.targetBand) lines.push(`Keep everything close to ${bandName(plan.targetBand)}. Never state an HSK level.`);
  lines.push("", "Words to use:", ...words(plan).map((w) => `- ${w}`));
  if (known.length > 0) lines.push("", `Words the learner already knows; write the reading with these and the words above, avoiding others where you can: ${known.slice(0, 200).join("、")}`);
  if (plan.grammar.length > 0) {
    lines.push("", "Grammar points, with an example of each:", ...plan.grammar.map((g) => `- ${g.itemId} = ${g.name}${g.example ? ` (example: ${g.example})` : ""}`));
  }
  lines.push(
    "",
    "reading: a new short text (2-5 lines) in the same topic, different from any dialogue, that uses every grammar point above and at least two of the words. Each line has zh (Simplified Chinese), pinyin (tone-marked) and en. Then 1-2 English comprehension questions with exactly 3 English options and answer_index 0-2.",
    "practice: 2-3 short controlled prompts. Each asks the learner to say or write one sentence that needs a grammar point (grammar_id is its id, or null if there is no grammar point) and one of the words. prompt_zh is the instruction or question in simple Chinese; prompt_en says the same in English; model_answer_zh is one good answer that uses the pattern.",
    "writing: a short writing prompt (prompt_zh and prompt_en) that asks the learner to carry out the task in 2-4 sentences, using the grammar points and some of the words.",
    "",
    "Return only the JSON object described by the schema.",
  );
  if (retry) lines.push("", RETRY[retry]);
  return lines.join("\n");
}

/** Whether the output uses every grammar pattern and enough words, and keeps practice grammar ids to the plan. */
export function coversPlan(output: MaterialsOutput, plan: SessionPlan): boolean {
  const reading = output.reading.lines.map((l) => l.zh).join("");
  const grammarOk = plan.grammar.every((g) => usesGrammar(reading, grammarMarkers(g.name)));
  const ws = words(plan);
  const wordsOk = wordsUsed(reading, ws).length >= Math.min(2, ws.length);
  const ids = new Set(plan.grammar.map((g) => g.itemId));
  const practiceOk = output.practice.every((p) => {
    if (p.grammar_id === null) return true;
    const g = plan.grammar.find((x) => x.itemId === p.grammar_id);
    return ids.has(p.grammar_id) && g !== undefined && usesGrammar(p.model_answer_zh, grammarMarkers(g.name));
  });
  return grammarOk && wordsOk && practiceOk;
}

export function parseMaterials(text: string | null): { ok: true; output: MaterialsOutput } | { ok: false; reason: MaterialsRejection } {
  if (text === null || text.trim() === "") return { ok: false, reason: "no_output" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = materialsOutputSchema.safeParse(raw);
  return parsed.success ? { ok: true, output: parsed.data } : { ok: false, reason: "schema" };
}

function shuffle(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

export function toStored(output: MaterialsOutput, random: () => number = Math.random): Stored {
  return {
    reading: {
      lines: output.reading.lines.map((l) => ({ zh: l.zh, pinyin: l.pinyin, en: l.en })),
      questions: output.reading.questions.map((q) => {
        const order = shuffle(q.options_en.length, random);
        return { questionEn: q.question_en, optionsEn: order.map((i) => q.options_en[i] as string), answerIndex: order.indexOf(q.answer_index) };
      }),
    },
    practice: output.practice.map((p) => ({ grammarId: p.grammar_id, promptZh: p.prompt_zh, promptEn: p.prompt_en, modelAnswerZh: p.model_answer_zh })),
    writing: { promptZh: output.writing.prompt_zh, promptEn: output.writing.prompt_en },
  };
}

/**
 * Built from the plan's own syllabus examples, for when the model cannot be
 * used. Not generated text: the reading is the examples, practice asks for a
 * sentence with each pattern.
 */
export function preparedMaterials(plan: SessionPlan): Stored {
  const examples = plan.grammar.flatMap((g) => (g.example ? [g.example] : []));
  const ws = words(plan);
  return {
    reading: {
      lines: (examples.length > 0 ? examples : ws.map((w) => `${w}。`)).slice(0, 5).map((zh) => ({ zh, pinyin: "", en: "Syllabus example; no translation available." })),
      questions: [],
    },
    practice: (plan.grammar.length > 0 ? plan.grammar : [null]).slice(0, 3).map((g) => ({
      grammarId: g?.itemId ?? null,
      promptZh: g ? `用“${g.name}”说一句话。` : `用“${ws[0] ?? "今天"}”说一句话。`,
      promptEn: g ? `Say one sentence using ${g.name}.` : `Say one sentence using ${ws[0] ?? "a word from today"}.`,
      modelAnswerZh: g?.example ?? `${ws[0] ?? "今天"}很好。`,
    })),
    writing: {
      promptZh: plan.task ? `请写两三句话：${plan.task.canDo}` : `请用今天的词写两三句话。`,
      promptEn: plan.task ? "Write two or three sentences that carry out today's task." : "Write two or three sentences using today's words.",
    },
  };
}

// --- Criteria -------------------------------------------------------------------------------

export function writingCriteria(plan: SessionPlan): WritingCriterion[] {
  const ws = words(plan);
  const need = Math.min(2, ws.length);
  const minChars = plan.durationMinutes <= 20 ? 15 : 25;
  return [
    ...plan.grammar.map((g) => ({ id: `grammar:${g.itemId}`, label: `Uses ${g.name}` })),
    ...(need > 0 ? [{ id: "words", label: `Uses at least ${need} of today's words` }] : []),
    { id: "length", label: `At least ${minChars} Chinese characters` },
  ];
}

export function checkWriting(plan: SessionPlan, answer: string): { checks: (WritingCriterion & { met: boolean })[]; passed: boolean; used: string[] } {
  const ws = words(plan);
  const used = wordsUsed(answer, ws);
  const checks = writingCriteria(plan).map((c) => {
    if (c.id.startsWith("grammar:")) {
      const g = plan.grammar.find((x) => `grammar:${x.itemId}` === c.id);
      return { ...c, met: g !== undefined && usesGrammar(answer, grammarMarkers(g.name)) };
    }
    if (c.id === "words") return { ...c, met: used.length >= Math.min(2, ws.length) };
    const min = plan.durationMinutes <= 20 ? 15 : 25;
    return { ...c, met: countHan(answer) >= min };
  });
  return { checks, passed: checks.every((c) => c.met), used };
}

export function checkPractice(plan: SessionPlan, grammarId: string | null, answer: string): { checks: (WritingCriterion & { met: boolean })[]; passed: boolean } {
  const g = grammarId ? plan.grammar.find((x) => x.itemId === grammarId) : undefined;
  const checks = [
    ...(g ? [{ id: `grammar:${g.itemId}`, label: `Uses ${g.name}`, met: usesGrammar(answer, grammarMarkers(g.name)) }] : []),
    { id: "chinese", label: "Answers in Chinese", met: countHan(answer) >= 2 },
  ];
  return { checks, passed: checks.every((c) => c.met) };
}

// --- Storage -----------------------------------------------------------------------------------

const COLUMNS =
  "session_id, status, source, model, stand_in, covers_targets, content_json, reading_answers_json, reading_correct, reading_answered_at, reading_revealed_at, practice_json, writing_json, created_at";

function readJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toMaterials(row: Row, plan: SessionPlan): LessonMaterials {
  const content = readJson<Stored | null>(row.content_json, null);
  if (!content) throw new ApiError("INTERNAL", "The saved materials could not be read.", false);
  const answers = readJson<number[] | null>(row.reading_answers_json, null);
  const open = row.reading_answered_at !== null || row.reading_revealed_at !== null;
  const practice = readJson<(AttemptResult | null)[]>(row.practice_json, []);
  return {
    sessionId: row.session_id,
    source: row.source === "prepared" ? "prepared" : "generated",
    standIn: row.stand_in === 1,
    coversTargets: row.covers_targets === 1,
    reading: {
      lines: content.reading.lines,
      questions: content.reading.questions.map((q) => ({ questionEn: q.questionEn, optionsEn: q.optionsEn, answerIndex: open ? q.answerIndex : null })),
      answers,
      correct: row.reading_correct,
      revealed: row.reading_revealed_at !== null,
      unassisted: row.reading_answered_at === null ? null : row.reading_revealed_at === null || row.reading_answered_at <= row.reading_revealed_at,
    },
    practice: content.practice.map((p, i) => ({ ...p, modelAnswerZh: practice[i] ? p.modelAnswerZh : null, result: practice[i] ?? null })),
    writing: { promptZh: content.writing.promptZh, promptEn: content.writing.promptEn, criteria: writingCriteria(plan), result: readJson<AttemptResult | null>(row.writing_json, null) },
  };
}

async function findRow(d1: D1Database, sessionId: string): Promise<Row | null> {
  return (await d1.prepare(`SELECT ${COLUMNS} FROM session_materials WHERE session_id = ?1`).bind(sessionId).first<Row>()) ?? null;
}

async function ready(d1: D1Database, session: SessionDetail): Promise<Row> {
  const row = await findRow(d1, session.id);
  if (!row || row.status !== "ready") throw new ApiError("NOT_FOUND", "This session's reading and practice have not been written yet.");
  return row;
}

export async function getMaterials(d1: D1Database, session: SessionDetail): Promise<LessonMaterials | null> {
  const row = await findRow(d1, session.id);
  return row?.status === "ready" ? toMaterials(row, session.plan) : null;
}

function providerFailure(error: ProviderError): ApiError {
  if (error.kind === "quota") {
    return new ApiError("PROVIDER_UNAVAILABLE", "The OpenAI account has no credit left or has reached a spending limit set at OpenAI.");
  }
  if (error.kind === "auth") return new ApiError("PROVIDER_UNAVAILABLE", "The tutor service refused the configured key. Check the OPENAI_API_KEY secret.");
  return new ApiError("PROVIDER_UNAVAILABLE", "The tutor could not write the reading and practice right now. Try again.", true);
}

async function reserve(d1: D1Database, sessionId: string, existing: Row | null, now: Date): Promise<void> {
  const busy = new ApiError("CONFLICT", "The reading and practice are still being written. Wait a moment.", true);
  if (existing) {
    const stale = new Date(now.getTime() - PENDING_STALE_MS).toISOString();
    const taken = await d1
      .prepare(
        `UPDATE session_materials SET status = 'pending', created_at = ?2
WHERE session_id = ?1 AND (status = 'failed' OR (status = 'pending' AND created_at < ?3))`,
      )
      .bind(sessionId, now.toISOString(), stale)
      .run();
    if (taken.meta.changes !== 1) throw busy;
    return;
  }
  const inserted = await d1
    .prepare("INSERT INTO session_materials (session_id, status, created_at) VALUES (?1, 'pending', ?2) ON CONFLICT (session_id) DO NOTHING")
    .bind(sessionId, now.toISOString())
    .run();
  if (inserted.meta.changes !== 1) throw busy;
}

function assertOpen(session: SessionDetail): void {
  if (session.status === "complete" || session.status === "abandoned") throw new ApiError("CONFLICT", "This session has ended. Start a new one from Today.");
  if (session.status === "paused") throw new ApiError("CONFLICT", "This session is paused. Resume it to continue.");
}

/** Writes the session's materials, or returns them if they exist. Two model tries, then prepared material. */
export async function createMaterials(
  d1: D1Database,
  provider: TutorProvider,
  sessionId: string,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<MaterialsResponse & { existing: boolean }> {
  const session = await getSession(d1, sessionId);
  const existing = await findRow(d1, session.id);
  if (existing?.status === "ready") return { materials: toMaterials(existing, session.plan), existing: true };
  assertOpen(session);
  await assertWithinRate(d1, now);
  await assertWithinBudget(d1, provider.paid, now);
  await reserve(d1, session.id, existing, now);

  try {
    const [vocabulary, known] = await Promise.all([vocabularySet(d1), knownWords(d1, session.id)]);
    const target = provider.mock ? null : coverageTarget(known.set.size);
    let best: Stored | null = null;
    let covers = false;
    let retry: MaterialsRejection | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !covers; attempt += 1) {
      let result;
      try {
        result = await provider.generate({
          instructions: buildMaterialsInstructions(session.plan, retry, known.recent),
          messages: [{ role: "user", content: "Write the materials." }],
          format: { name: MATERIALS_FORMAT_NAME, schema: MATERIALS_OUTPUT_JSON_SCHEMA, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS },
          context: {
            targets: session.plan.targets.map((t) => ({ id: t.itemId, hanzi: t.hanzi })),
            colloquial: [],
            grammar: session.plan.grammar.map((g) => ({ id: g.itemId, name: g.name, example: g.example })),
            task: session.plan.task ? { canDo: session.plan.task.canDo } : null,
            turnIndex: 0,
            attempt,
          },
        });
      } catch (error) {
        await recordUsage(d1, { provider: provider.vendor, operation: LISTENING_OPERATION, model: provider.model, usage: { tokensIn: 0, tokensOut: 0 }, estimatedUsd: 0, status: "error", sessionId: session.id }, now);
        throw error instanceof ProviderError ? providerFailure(error) : error;
      }
      const parsed = parseMaterials(result.text);
      const read = parsed.ok ? coverage(parsed.output.reading.lines.map((l) => l.zh).join(""), vocabulary, known.set) : null;
      const pitched = target === null || !read || read.total === 0 || read.known / read.total >= target;
      const ok = parsed.ok && coversPlan(parsed.output, session.plan) && pitched;
      await recordUsage(
        d1,
        { provider: provider.vendor, operation: LISTENING_OPERATION, model: provider.model, usage: result.usage, estimatedUsd: provider.estimateUsd(result.usage), status: parsed.ok ? "ok" : "invalid", sessionId: session.id },
        now,
      );
      if (parsed.ok) {
        best = toStored(parsed.output, random);
        covers = ok;
        if (!ok) retry = "coverage";
      } else {
        retry = parsed.reason;
      }
    }
    const source = best ? "generated" : "prepared";
    const content = best ?? preparedMaterials(session.plan);
    const at = now.toISOString();
    await d1.batch([
      d1
        .prepare(
          `UPDATE session_materials SET status = 'ready', source = ?2, model = ?3, stand_in = ?4, covers_targets = ?5, content_json = ?6, created_at = ?7
WHERE session_id = ?1 AND status = 'pending'`,
        )
        .bind(session.id, source, best ? provider.model : null, best && provider.mock ? 1 : 0, best ? (covers ? 1 : 0) : 1, JSON.stringify(content), at),
      d1
        .prepare(`UPDATE sessions SET status = 'active', started_at = COALESCE(started_at, ?2), ${accrueSql("?2")}, last_activity_at = ?2 WHERE id = ?1 AND status IN ('planned','active')`)
        .bind(session.id, at),
    ]);
  } catch (error) {
    await d1.prepare("UPDATE session_materials SET status = 'failed' WHERE session_id = ?1 AND status = 'pending'").bind(session.id).run();
    throw error;
  }
  return { materials: toMaterials(await ready(d1, session), session.plan), existing: false };
}

/** One attempt about one imported item; fixed criteria count as a rubric. */
function attemptStatement(
  d1: D1Database,
  sessionId: string,
  itemId: string,
  skill: string,
  assessment: string,
  promptId: string,
  answer: string,
  success: boolean,
  qualifying: boolean,
  at: string,
) {
  return d1
    .prepare(
      `INSERT INTO practice_attempts (id, session_id, curriculum_item_id, skill, assessment_type, prompt_id, user_response, score, score_source, is_qualifying_recall, success, attempted_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'rubric', ?9, ?10, ?11)`,
    )
    .bind(crypto.randomUUID(), sessionId, itemId, skill, assessment, promptId, answer, success ? 1 : 0, qualifying ? 1 : 0, success ? 1 : 0, at);
}

/** Scores the reading questions; the first answers are kept, and only answers before the translation count as unassisted. */
export async function answerReading(d1: D1Database, sessionId: string, answers: readonly number[], now: Date = new Date()): Promise<MaterialsResponse> {
  const session = await getSession(d1, sessionId);
  const row = await ready(d1, session);
  const content = readJson<Stored | null>(row.content_json, null);
  const questions = content?.reading.questions ?? [];
  if (answers.length !== questions.length) throw new ApiError("BAD_REQUEST", `Send one answer for each of the ${questions.length} questions.`);
  if (row.reading_answered_at === null) {
    const correct = answers.filter((a, i) => a === questions[i]?.answerIndex).length;
    const at = now.toISOString();
    // The result stays with the materials: a question is about the text, not about one item.
    await d1
      .prepare("UPDATE session_materials SET reading_answers_json = ?2, reading_correct = ?3, reading_answered_at = ?4 WHERE session_id = ?1 AND reading_answered_at IS NULL")
      .bind(session.id, JSON.stringify(answers), correct, at)
      .run();
  }
  return { materials: toMaterials(await ready(d1, session), session.plan) };
}

export async function revealReading(d1: D1Database, sessionId: string, now: Date = new Date()): Promise<MaterialsResponse> {
  const session = await getSession(d1, sessionId);
  await ready(d1, session);
  await d1.prepare("UPDATE session_materials SET reading_revealed_at = COALESCE(reading_revealed_at, ?2) WHERE session_id = ?1").bind(session.id, now.toISOString()).run();
  return { materials: toMaterials(await ready(d1, session), session.plan) };
}

/** Checks one guided-practice answer by fixed criteria and records it as production evidence for its grammar point. */
export async function answerPractice(
  d1: D1Database,
  sessionId: string,
  index: number,
  answer: string,
  mode: "spoken" | "typed",
  now: Date = new Date(),
): Promise<MaterialsResponse> {
  const session = await getSession(d1, sessionId);
  assertOpen(session);
  const row = await ready(d1, session);
  const content = readJson<Stored | null>(row.content_json, null);
  const prompt = content?.practice[index];
  if (!prompt) throw new ApiError("BAD_REQUEST", "There is no practice prompt with that number.");
  const results = readJson<(AttemptResult | null)[]>(row.practice_json, []);
  const at = now.toISOString();
  const { checks, passed } = checkPractice(session.plan, prompt.grammarId, answer);
  results[index] = { answer, mode, checks, passed, at };
  // A typed answer is writing evidence, never speaking (SPEC §5.5).
  const skill = mode === "spoken" ? "speaking" : "writing";
  await d1.batch([
    d1.prepare("UPDATE session_materials SET practice_json = ?2 WHERE session_id = ?1").bind(session.id, JSON.stringify(results)),
    // Evidence belongs to an item: the prompt's grammar point, or else the first word the answer uses.
    ...[prompt.grammarId ?? session.plan.targets.find((t) => answer.includes(t.hanzi))?.itemId].flatMap((itemId) =>
      itemId ? [attemptStatement(d1, session.id, itemId, skill, "guided_practice", `practice:${session.id}:${index}`, answer, passed, true, at)] : [],
    ),
    d1.prepare(`UPDATE sessions SET ${accrueSql("?2")}, last_activity_at = ?2 WHERE id = ?1 AND status = 'active'`).bind(session.id, at),
  ]);
  return { materials: toMaterials(await ready(d1, session), session.plan) };
}

/** Checks the written task by fixed criteria; each grammar point and word used counts as writing evidence. */
export async function answerWriting(d1: D1Database, sessionId: string, answer: string, now: Date = new Date()): Promise<MaterialsResponse> {
  const session = await getSession(d1, sessionId);
  assertOpen(session);
  await ready(d1, session);
  const at = now.toISOString();
  const { checks, passed, used } = checkWriting(session.plan, answer);
  const result: AttemptResult = { answer, mode: "typed", checks, passed, at };
  const usedIds = session.plan.targets.filter((t) => used.includes(t.hanzi)).map((t) => t.itemId);
  await d1.batch([
    d1.prepare("UPDATE session_materials SET writing_json = ?2 WHERE session_id = ?1").bind(session.id, JSON.stringify(result)),
    ...session.plan.grammar.map((g) =>
      attemptStatement(d1, session.id, g.itemId, "writing", "writing_task", `writing:${session.id}`, answer, checks.find((c) => c.id === `grammar:${g.itemId}`)?.met ?? false, true, at),
    ),
    ...usedIds.map((id) => attemptStatement(d1, session.id, id, "writing", "writing_task", `writing:${session.id}`, answer, true, true, at)),
    d1.prepare(`UPDATE sessions SET ${accrueSql("?2")}, last_activity_at = ?2 WHERE id = ?1 AND status = 'active'`).bind(session.id, at),
  ]);
  return { materials: toMaterials(await ready(d1, session), session.plan) };
}
