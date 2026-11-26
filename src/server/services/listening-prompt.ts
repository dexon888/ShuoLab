/**
 * Instructions and checks for the "Listen first" exercise (SPEC §5.3 step 2,
 * §6.5). Pure functions: no database, no provider. The instructions are built
 * from the saved plan only; no learner text goes into them.
 */
import { listeningOutputSchema, type ListeningLine, type ListeningOutput } from "../../shared/listening";
import type { SessionPlan } from "../../shared/session";
import type { AllowedTarget } from "./tutor-prompt";

export type ListeningRejection = "no_output" | "not_json" | "schema";

const RETRY_NOTES: Readonly<Record<ListeningRejection, string>> = {
  no_output: "Your previous answer was empty or refused. Write the exchange and questions.",
  not_json: "Your previous answer was not valid JSON. Return only the JSON object.",
  schema:
    "Your previous answer did not match the required fields: 4-6 short Mandarin lines, 2-3 questions, exactly 3 different options each, and answer_index 0, 1 or 2.",
};

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7-9" : `HSK ${band}`;
}

export function buildListeningInstructions(
  plan: SessionPlan,
  targets: readonly Pick<AllowedTarget, "hanzi" | "pinyin">[],
  retry: ListeningRejection | null,
): string {
  const lines = [
    "Write a short listening exercise for one adult learner of Mandarin.",
    "",
    "The exchange:",
    "- 4 to 6 lines of natural, everyday spoken Mandarin between two people, A and B, taking turns.",
    "- Simplified Chinese characters in `zh`, one or two short sentences per line.",
    "- `pinyin`: tone-marked pinyin for the whole line. `en`: a natural English translation.",
    "- It must contain concrete details (a time, a place, a choice, a reason) that a listener can be asked about.",
    "- No slang, and no names of real people or businesses.",
    "",
    `Situation (written for this app, not an HSK topic): ${plan.situation.titleZh} / ${plan.situation.titleEn}.`,
    `Goal: ${plan.situation.communicativeGoal}`,
  ];

  if (plan.kind === "hsk" && plan.targetBand) {
    lines.push(
      "",
      `The learner is studying ${bandName(plan.targetBand)}. Keep vocabulary and grammar close to that level.`,
      "Use two or three of these words where they fit naturally:",
      ...targets.map((t) => `- ${t.hanzi}${t.pinyin ? ` (${t.pinyin})` : ""}`),
      "Never state an HSK level for any word.",
    );
  } else {
    lines.push("", "Keep the language simple and everyday. Never state an HSK level for any word.");
  }

  lines.push(
    "",
    "The questions:",
    "- 2 or 3 questions in English about what was said, each answerable only by understanding the audio.",
    "- Exactly 3 options per question, in English, all plausible, with exactly one correct.",
    "- answer_index is the position (0, 1 or 2) of the correct option.",
    "- Do not ask about a word's meaning on its own; ask about what the speakers mean, want or decide.",
    "",
    "Return only the JSON object described by the schema.",
  );
  if (retry) lines.push("", RETRY_NOTES[retry]);
  return lines.join("\n");
}

export type ParsedListening = { ok: true; output: ListeningOutput } | { ok: false; reason: ListeningRejection };

export function parseListeningOutput(text: string | null): ParsedListening {
  if (text === null || text.trim().length === 0) return { ok: false, reason: "no_output" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = listeningOutputSchema.safeParse(raw);
  return parsed.success ? { ok: true, output: parsed.data } : { ok: false, reason: "schema" };
}

/** What is saved: the exchange and the questions with the answer's position after shuffling. */
export interface StoredListening {
  lines: ListeningLine[];
  questions: { questionEn: string; optionsEn: string[]; answerIndex: number }[];
}

/**
 * Models tend to put the right answer first, so each question's options are
 * shuffled before saving. `random` is injectable for tests.
 */
export function toStored(output: ListeningOutput, random: () => number = Math.random): StoredListening {
  return {
    lines: output.lines.map((l) => ({ speaker: l.speaker, zh: l.zh, pinyin: l.pinyin, en: l.en })),
    questions: output.questions.map((q) => {
      const order = q.options_en.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j] as number, order[i] as number];
      }
      return {
        questionEn: q.question_en,
        optionsEn: order.map((i) => q.options_en[i] as string),
        answerIndex: order.indexOf(q.answer_index),
      };
    }),
  };
}

/**
 * Written for ShuoLab, used when the model's answer cannot be used twice in a
 * row. It is not HSK content and not about the session's situation.
 */
export const PREPARED_LISTENING: ListeningOutput = {
  lines: [
    { speaker: "A", zh: "你周末有空吗？", pinyin: "Nǐ zhōumò yǒu kòng ma?", en: "Are you free this weekend?" },
    { speaker: "B", zh: "星期六下午有空。怎么了？", pinyin: "Xīngqīliù xiàwǔ yǒu kòng. Zěnme le?", en: "I'm free on Saturday afternoon. Why?" },
    {
      speaker: "A",
      zh: "我想去看电影，你想一起去吗？",
      pinyin: "Wǒ xiǎng qù kàn diànyǐng, nǐ xiǎng yìqǐ qù ma?",
      en: "I'd like to see a film. Do you want to come?",
    },
    {
      speaker: "B",
      zh: "好啊。我们三点在电影院门口见吧。",
      pinyin: "Hǎo a. Wǒmen sān diǎn zài diànyǐngyuàn ménkǒu jiàn ba.",
      en: "Sure. Let's meet at the cinema entrance at three.",
    },
  ],
  questions: [
    { question_en: "When is the second speaker free?", options_en: ["Saturday afternoon", "Saturday morning", "Sunday afternoon"], answer_index: 0 },
    { question_en: "What does the first speaker want to do?", options_en: ["See a film", "Eat hotpot", "Go shopping"], answer_index: 0 },
    { question_en: "Where will they meet?", options_en: ["At the cinema entrance", "At a subway station", "At home"], answer_index: 0 },
  ],
};
