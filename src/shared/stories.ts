/**
 * Graded stories and dialogues for extensive input (SPEC §2.6 rule 5, §5.10,
 * FR-036). Written by the tutor model at the learner's band and known words,
 * outside the daily session, with questions answered before the translation
 * and every minute logged as input time. Not HSK content.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";

export const STORY_FORMAT_NAME = "graded_story";
export const STORY_KINDS = ["story", "dialogue"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];
export const MAX_STORY_MINUTES = 60;

const OPTIONS = 3;

export const storyOutputSchema = z
  .object({
    title_zh: z.string().trim().min(1).max(40),
    title_en: z.string().trim().min(1).max(80),
    lines: z
      .array(
        z
          .object({
            /** "A" or "B" in a dialogue; null for narration. */
            speaker: z.enum(["A", "B"]).nullable(),
            zh: z.string().trim().min(1).max(120),
            pinyin: z.string().trim().min(1).max(400),
            en: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .min(4)
      .max(14),
    questions: z
      .array(
        z
          .object({
            question_en: z.string().trim().min(1).max(200),
            options_en: z.array(z.string().trim().min(1).max(120)).length(OPTIONS),
            answer_index: z.number().int().min(0).max(OPTIONS - 1),
          })
          .strict(),
      )
      .min(2)
      .max(3),
  })
  .strict();
export type StoryOutput = z.infer<typeof storyOutputSchema>;

export const STORY_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title_zh", "title_en", "lines", "questions"],
  properties: {
    title_zh: { type: "string" },
    title_en: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "zh", "pinyin", "en"],
        properties: { speaker: { type: ["string", "null"], enum: ["A", "B", null] }, zh: { type: "string" }, pinyin: { type: "string" }, en: { type: "string" } },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_en", "options_en", "answer_index"],
        properties: { question_en: { type: "string" }, options_en: { type: "array", items: { type: "string" } }, answer_index: { type: "integer" } },
      },
    },
  },
} as const;

export const storySummarySchema = z.object({
  id: z.string(),
  kind: z.enum(STORY_KINDS),
  band: z.enum(HSK_BANDS),
  titleZh: z.string(),
  titleEn: z.string(),
  episode: z.number().int().positive(),
  createdAt: z.string(),
  /** Known tokens of all tokens when it was written. */
  coverage: z.object({ known: z.number().int(), total: z.number().int() }),
  finishedAt: z.string().nullable(),
  minutes: z.number().nonnegative(),
});
export type StorySummary = z.infer<typeof storySummarySchema>;

export const storySchema = storySummarySchema.extend({
  standIn: z.boolean(),
  lines: z.array(z.object({ speaker: z.enum(["A", "B"]).nullable(), zh: z.string(), pinyin: z.string(), en: z.string() })),
  questions: z.array(z.object({ questionEn: z.string(), optionsEn: z.array(z.string()), answerIndex: z.number().int().nullable() })),
  answers: z.array(z.number().int()).nullable(),
  correct: z.number().int().nullable(),
  /** True once the translation has been shown. */
  revealed: z.boolean(),
  unassisted: z.boolean().nullable(),
  /** Meanings for the syllabus words in the text, each with its source; tap a word to see it. */
  glossary: z.record(z.string(), z.object({ pinyin: z.string().nullable(), definition: z.string().nullable(), provenance: z.string().nullable() })),
});
export type Story = z.infer<typeof storySchema>;

export const storyResponseSchema = z.object({ story: storySchema });
export const storyListResponseSchema = z.object({
  stories: z.array(storySummarySchema),
  /** Minutes of story reading and listening in the last 7 days. */
  minutesThisWeek: z.number().nonnegative(),
  minutesTotal: z.number().nonnegative(),
});

export const newStoryRequestSchema = z.object({ kind: z.enum(STORY_KINDS).default("story"), continueSeries: z.boolean().default(true) }).strict();
export const storyAnswersRequestSchema = z.object({ answers: z.array(z.number().int().min(0).max(OPTIONS - 1)).min(1).max(3) }).strict();
export const storyFinishRequestSchema = z.object({ minutes: z.number().min(0).max(MAX_STORY_MINUTES) }).strict();
