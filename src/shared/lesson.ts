/**
 * The connected lesson (SPEC §2.5, §5.3, §6.2, §6.3): grammar patterns, the
 * session spine and its time budget, and the contracts for the material the
 * spine needs (reading, guided practice, writing).
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import type { SessionMinutes, Skill } from "./learning";

// --- Grammar patterns -------------------------------------------------------------

const HAN = /\p{Script=Han}/u;
/** Gaps in a pattern as the syllabus writes them: 是……的, —们, 越…越. */
const GAP = /……|…|——|—|～|~|＋|\+/;

/**
 * The ways a grammar point can show up in text, read from how the syllabus
 * names it: alternatives are separated by 、 or ／, and gaps inside one
 * alternative split it into parts that must appear in order. Parts are Han
 * only; anything in brackets is a note, not part of the pattern.
 *
 *   "上、下、里、外" → [["上"], ["下"], ["里"], ["外"]]
 *   "是……的"       → [["是", "的"]]
 *   "—们、—边"     → [["们"], ["边"]]
 */
export function grammarMarkers(name: string): string[][] {
  const cleaned = name.replace(/[（(][^）)]*[）)]/g, " ");
  const out: string[][] = [];
  for (const alternative of cleaned.split(/[、／/，,；;]/)) {
    const parts = alternative
      .split(GAP)
      .map((p) => [...p].filter((ch) => HAN.test(ch)).join(""))
      .filter((p) => p.length > 0);
    if (parts.length > 0 && !out.some((o) => o.join("|") === parts.join("|"))) out.push(parts);
  }
  return out;
}

/** True when any alternative's parts appear in `text`, in order. */
export function usesGrammar(text: string, markers: readonly (readonly string[])[]): boolean {
  return markers.some((parts) => {
    let from = 0;
    for (const part of parts) {
      const at = text.indexOf(part, from);
      if (at < 0) return false;
      from = at + part.length;
    }
    return parts.length > 0;
  });
}

/**
 * A point can be checked in text only when its name gives a pattern and at
 * least one of its own syllabus examples shows that pattern. Points such as
 * 陈述句 (a kind of sentence) cannot, and the planner leaves them out.
 */
export function isCheckableGrammar(name: string, examples: readonly string[]): boolean {
  const markers = grammarMarkers(name);
  return markers.length > 0 && examples.some((e) => usesGrammar(e, markers));
}

/** Whether `text` uses at least one of `words`, and which. */
export function wordsUsed(text: string, words: readonly string[]): string[] {
  return words.filter((w) => w.length > 0 && text.includes(w));
}

// --- Plan parts ---------------------------------------------------------------------

export const planGrammarSchema = z.object({
  itemId: z.string(),
  sourceId: z.number().int().positive(),
  hskBand: z.enum(HSK_BANDS),
  /** The point as the syllabus names it, e.g. 是……的. */
  name: z.string(),
  grammarType: z.string(),
  /** One syllabus example that shows the pattern. */
  example: z.string().nullable(),
  /** `new`: first time. `recycled`: targeted before and not mastered. */
  role: z.enum(["new", "recycled"]),
  /** True when it comes from an unverified source (SPEC §2.5 rule 1). */
  unverified: z.boolean(),
});
export type PlanGrammar = z.infer<typeof planGrammarSchema>;

export const planCharacterSchema = z.object({
  itemId: z.string(),
  hanzi: z.string(),
  /** `recognition` or `writing` list of the band. */
  skill: z.enum(["recognition", "writing"]),
  /** A word containing the character: a target word or one already met. */
  word: z.string(),
  unverified: z.boolean(),
});
export type PlanCharacter = z.infer<typeof planCharacterSchema>;

export const planTopicSchema = z.object({
  itemId: z.string(),
  area: z.string(),
  subject: z.string(),
  details: z.string(),
  unverified: z.boolean(),
});
export type PlanTopic = z.infer<typeof planTopicSchema>;

export const planTaskSchema = z.object({
  itemId: z.string(),
  task: z.string(),
  /** The can-do statement: the session's goal (SPEC §2.4). */
  canDo: z.string(),
  unverified: z.boolean(),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

// --- The spine -------------------------------------------------------------------------

/** SPEC §5.3: every session, in this order. */
export const SPINE = ["warmup", "listen", "notice", "read", "practice", "speak", "write", "summary"] as const;
export type SpineStep = (typeof SPINE)[number];

export const STEP_SKILL: Readonly<Record<SpineStep, Skill>> = {
  warmup: "reading",
  listen: "listening",
  notice: "reading",
  read: "reading",
  practice: "speaking",
  speak: "speaking",
  write: "writing",
  summary: "reading",
};

/** Minutes per step (SPEC §5.3). The summary is read afterwards and has no budget. */
export const SPINE_BUDGETS: Readonly<Record<SessionMinutes, Readonly<Record<SpineStep, number>>>> = {
  15: { warmup: 2, listen: 3, notice: 1, read: 2, practice: 2, speak: 4, write: 1, summary: 0 },
  20: { warmup: 2, listen: 3, notice: 2, read: 2, practice: 3, speak: 6, write: 2, summary: 0 },
  25: { warmup: 3, listen: 4, notice: 2, read: 3, practice: 3, speak: 7, write: 3, summary: 0 },
  30: { warmup: 3, listen: 5, notice: 2, read: 4, practice: 4, speak: 8, write: 4, summary: 0 },
};

/** Minutes moved toward the weakest skill (SPEC §5.3: up to 20%). */
export const SKILL_SHIFT_MINUTES: Readonly<Record<SessionMinutes, number>> = { 15: 1, 20: 2, 25: 2, 30: 3 };

const MAIN_STEP: Readonly<Record<Skill, SpineStep>> = { listening: "listen", speaking: "speak", reading: "read", writing: "write" };

const ORAL: readonly SpineStep[] = ["listen", "practice", "speak"];

/**
 * The step budget for a session, with minutes moved from the biggest other
 * step to the weakest skill's step, never leaving listening and speaking
 * under 40% of the session.
 */
export function spineBudget(minutes: SessionMinutes, weakest: Skill | null): Record<SpineStep, number> {
  const budget = { ...SPINE_BUDGETS[minutes] };
  if (!weakest) return budget;
  const to = MAIN_STEP[weakest];
  const shift = SKILL_SHIFT_MINUTES[minutes];
  const donors = SPINE.filter((s) => s !== to && s !== "summary").sort((a, b) => budget[b] - budget[a]);
  for (const from of donors) {
    const trial = { ...budget, [from]: budget[from] - shift, [to]: budget[to] + shift };
    const oral = ORAL.reduce((n, s) => n + trial[s], 0);
    if (trial[from] >= 1 && oral * 5 >= minutes * 2) return trial;
  }
  return budget;
}

/** Per-session caps (SPEC §6.2). */
export const MAX_NEW_WORDS = 5;
export const MAX_EXTRA_CHARACTERS = 3;
export function grammarCap(minutes: SessionMinutes): number {
  return minutes === 15 ? 1 : 2;
}
export function slangAllowed(minutes: SessionMinutes): boolean {
  return minutes >= 20;
}

/** Learner turns after which an unused grammar point must be elicited (SPEC §6.3). */
export const ELICIT_AFTER_TURNS = 4;

// --- Materials: reading, guided practice, writing -------------------------------------

export const MATERIALS_FORMAT_NAME = "lesson_materials";

const optionCount = 3;

export const materialsOutputSchema = z
  .object({
    reading: z
      .object({
        lines: z
          .array(z.object({ zh: z.string().trim().min(1).max(120), pinyin: z.string().trim().min(1).max(400), en: z.string().trim().min(1).max(300) }).strict())
          .min(2)
          .max(6),
        questions: z
          .array(
            z
              .object({
                question_en: z.string().trim().min(1).max(200),
                options_en: z.array(z.string().trim().min(1).max(120)).length(optionCount),
                answer_index: z.number().int().min(0).max(optionCount - 1),
              })
              .strict(),
          )
          .min(1)
          .max(2),
      })
      .strict(),
    practice: z
      .array(
        z
          .object({
            grammar_id: z.string().max(120).nullable(),
            prompt_zh: z.string().trim().min(1).max(160),
            prompt_en: z.string().trim().min(1).max(240),
            model_answer_zh: z.string().trim().min(1).max(160),
          })
          .strict(),
      )
      .min(2)
      .max(3),
    writing: z.object({ prompt_zh: z.string().trim().min(1).max(200), prompt_en: z.string().trim().min(1).max(300) }).strict(),
  })
  .strict();
export type MaterialsOutput = z.infer<typeof materialsOutputSchema>;

export const MATERIALS_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "practice", "writing"],
  properties: {
    reading: {
      type: "object",
      additionalProperties: false,
      required: ["lines", "questions"],
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["zh", "pinyin", "en"],
            properties: { zh: { type: "string" }, pinyin: { type: "string" }, en: { type: "string" } },
          },
        },
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question_en", "options_en", "answer_index"],
            properties: {
              question_en: { type: "string" },
              options_en: { type: "array", items: { type: "string" } },
              answer_index: { type: "integer" },
            },
          },
        },
      },
    },
    practice: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["grammar_id", "prompt_zh", "prompt_en", "model_answer_zh"],
        properties: {
          grammar_id: { type: ["string", "null"] },
          prompt_zh: { type: "string" },
          prompt_en: { type: "string" },
          model_answer_zh: { type: "string" },
        },
      },
    },
    writing: {
      type: "object",
      additionalProperties: false,
      required: ["prompt_zh", "prompt_en"],
      properties: { prompt_zh: { type: "string" }, prompt_en: { type: "string" } },
    },
  },
} as const;

// --- Materials API --------------------------------------------------------------------------

export const readingQuestionSchema = z.object({
  questionEn: z.string(),
  optionsEn: z.array(z.string()),
  /** Withheld until answered or the translation is shown. */
  answerIndex: z.number().int().nonnegative().nullable(),
});

export const practicePromptSchema = z.object({
  grammarId: z.string().nullable(),
  promptZh: z.string(),
  promptEn: z.string(),
  /** Shown after an answer is checked. */
  modelAnswerZh: z.string().nullable(),
});

export const writingCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type WritingCriterion = z.infer<typeof writingCriterionSchema>;

export const attemptResultSchema = z.object({
  answer: z.string(),
  /** How the answer was given: aloud (speech recognition) or typed. */
  mode: z.enum(["spoken", "typed"]),
  /** Each criterion and whether it was met. */
  checks: z.array(writingCriterionSchema.extend({ met: z.boolean() })),
  passed: z.boolean(),
  at: z.string(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

export const materialsSchema = z.object({
  sessionId: z.string(),
  source: z.enum(["generated", "prepared"]),
  standIn: z.boolean(),
  /** False when the generated text did not contain every target pattern after retries. */
  coversTargets: z.boolean(),
  reading: z.object({
    lines: z.array(z.object({ zh: z.string(), pinyin: z.string(), en: z.string() })),
    questions: z.array(readingQuestionSchema),
    answers: z.array(z.number().int().nonnegative()).nullable(),
    correct: z.number().int().nonnegative().nullable(),
    /** True once the translation has been shown. */
    revealed: z.boolean(),
    /** True when the answers came before the translation. */
    unassisted: z.boolean().nullable(),
  }),
  practice: z.array(practicePromptSchema.extend({ result: attemptResultSchema.nullable() })),
  writing: z.object({
    promptZh: z.string(),
    promptEn: z.string(),
    criteria: z.array(writingCriterionSchema),
    result: attemptResultSchema.nullable(),
  }),
});
export type LessonMaterials = z.infer<typeof materialsSchema>;

export const materialsResponseSchema = z.object({ materials: materialsSchema });
export type MaterialsResponse = z.infer<typeof materialsResponseSchema>;

export const readingAnswersRequestSchema = z.object({ answers: z.array(z.number().int().min(0).max(optionCount - 1)).min(1).max(2) }).strict();
export const readingRevealRequestSchema = z.object({}).strict();
export const practiceAnswerRequestSchema = z
  .object({ index: z.number().int().min(0).max(2), answer: z.string().trim().min(1).max(300), mode: z.enum(["spoken", "typed"]) })
  .strict();
export const writingAnswerRequestSchema = z.object({ answer: z.string().trim().min(1).max(1000) }).strict();

