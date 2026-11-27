/**
 * Fake providers for local development and tests. They make no network calls,
 * cost nothing, and are deterministic. They are never used in production.
 */
import { SPEECH_TOKEN_REUSE_SECONDS } from "../../shared/speech";
import { MATERIALS_FORMAT_NAME, type MaterialsOutput } from "../../shared/lesson";
import { LISTENING_FORMAT_NAME, type ListeningOutput } from "../../shared/listening";
import type { TutorOutput } from "../../shared/tutor";
import type {
  SpeechToken,
  SpeechTokenProvider,
  TokenUsage,
  TutorProvider,
  TutorRawResult,
  TutorRequest,
} from "./types";

export interface FakeTutorOptions {
  /**
   * Replaces the built-in answer, for tests: return the raw text a model
   * might produce (valid or not), null for "no usable output", or throw.
   */
  respond?: (request: TutorRequest) => string | null;
  /** Pretend each call used these tokens, to exercise metering. */
  usage?: TokenUsage;
  /** Pretend calls cost this much per token, to exercise the budget gate. */
  usdPerToken?: number;
}

/** A canned Mandarin reply built from the session's own target words. Not a language model. */
export function fakeTutorOutput(request: TutorRequest): TutorOutput {
  const { targets, turnIndex } = request.context;
  const target = targets.length > 0 ? targets[turnIndex % targets.length] : undefined;
  const grammar = request.context.grammar ?? [];
  // A grammar point to use: one that must be elicited, else one in turn.
  const must = grammar.find((g) => request.context.mustElicit?.includes(g.id));
  const point = must ?? (grammar.length > 0 ? grammar[turnIndex % grammar.length] : undefined);
  const example = point?.example ? `比如：${point.example}` : "";
  const base = target ? `好的。我们来聊聊“${target.hanzi}”吧，你觉得怎么样？` : "好的。你今天过得怎么样？";
  return {
    spoken_reply_zh: `${base}${example}`.slice(0, 380),
    used_grammar_ids: point?.example ? [point.id] : [],
    elicited_grammar_ids: must?.example ? [must.id] : [],
    optional_pinyin: null,
    optional_translation_en: target
      ? "OK. Let's talk about this word. What do you think? (Practice stand-in reply.)"
      : "OK. How has your day been? (Practice stand-in reply.)",
    referenced_curriculum_item_ids: target ? [target.id] : [],
    referenced_colloquial_ids: [],
    semantic_feedback: { understood_intent: true, corrections: [], encouragement_zh: null },
    suggested_followup_topic: null,
  };
}

/**
 * A canned listening exchange that mentions the session's first target word.
 * Not a language model, and its answers are always the first option before
 * the server shuffles them.
 */
export function fakeListeningOutput(request: TutorRequest): ListeningOutput {
  const word = request.context.targets[0]?.hanzi;
  // Each grammar point's syllabus example, and every word, so the exchange covers the plan.
  const examples = (request.context.grammar ?? []).flatMap((g) => (g.example ? [g.example] : []));
  const words = request.context.targets.map((t) => t.hanzi).join("、");
  const extra = [
    ...examples.map((zh, i) => ({ speaker: (i % 2 === 0 ? "B" : "A") as "A" | "B", zh: zh.slice(0, 110), pinyin: "(stand-in)", en: "A syllabus example. (Practice stand-in.)" })),
    ...(words ? [{ speaker: "B" as const, zh: `今天的词有：${words}。`.slice(0, 110), pinyin: "(stand-in)", en: "Today's words. (Practice stand-in.)" }] : []),
  ].slice(0, 5);
  return {
    lines: [
      ...extra,
      { speaker: "A", zh: "你周末有空吗？", pinyin: "Nǐ zhōumò yǒu kòng ma?", en: "Are you free this weekend?" },
      { speaker: "B", zh: "星期六下午有空。", pinyin: "Xīngqīliù xiàwǔ yǒu kòng.", en: "I'm free on Saturday afternoon." },
      {
        speaker: "A",
        zh: word ? `我们一起去吧，我想说说“${word}”。` : "我们一起去喝茶吧。",
        pinyin: word ? "Wǒmen yìqǐ qù ba, wǒ xiǎng shuōshuo …" : "Wǒmen yìqǐ qù hē chá ba.",
        en: word ? "Let's go together; I want to talk about this word. (Practice stand-in.)" : "Let's go for tea together. (Practice stand-in.)",
      },
    ],
    questions: [
      { question_en: "When is the second speaker free?", options_en: ["Saturday afternoon", "Sunday morning", "Friday evening"], answer_index: 0 },
      { question_en: "What does the first speaker suggest?", options_en: ["Doing something together", "Staying at home", "Working late"], answer_index: 0 },
    ],
  };
}

/**
 * Canned reading, practice and writing built from the session's own grammar
 * examples and words. Not a language model; the reading answer is always
 * the first option before the server shuffles them.
 */
export function fakeMaterialsOutput(request: TutorRequest): MaterialsOutput {
  const grammar = request.context.grammar ?? [];
  const words = request.context.targets.map((t) => t.hanzi);
  const examples = grammar.flatMap((g) => (g.example ? [g.example] : []));
  const lines = [
    ...examples.map((zh) => ({ zh: zh.slice(0, 110), pinyin: "(stand-in)", en: "A syllabus example. (Practice stand-in.)" })),
    { zh: `我今天学了${words.slice(0, 3).join("、") || "新词"}。`, pinyin: "(stand-in)", en: "I learned today's words. (Practice stand-in.)" },
    { zh: "我觉得很有意思。", pinyin: "Wǒ juéde hěn yǒu yìsi.", en: "I think it's interesting." },
  ].slice(0, 6);
  const prompts = (grammar.length > 0 ? grammar : [null]).slice(0, 3).map((g) => ({
    grammar_id: g?.example ? g.id : null,
    prompt_zh: g ? `用“${g.name}”说一句话。` : "用今天的词说一句话。",
    prompt_en: g ? `Say one sentence using ${g.name}. (Practice stand-in.)` : "Say one sentence with today's words. (Practice stand-in.)",
    model_answer_zh: g?.example ?? `${words[0] ?? "今天"}很好。`,
  }));
  if (prompts.length < 2) prompts.push({ grammar_id: null, prompt_zh: "用今天的词说一句话。", prompt_en: "Say one sentence with today's words. (Practice stand-in.)", model_answer_zh: `${words[0] ?? "今天"}很好。` });
  return {
    reading: {
      lines,
      questions: [{ question_en: "What did the writer learn? (Practice stand-in.)", options_en: ["Today's words", "How to cook", "A song"], answer_index: 0 }],
    },
    practice: prompts,
    writing: {
      prompt_zh: request.context.task ? `请写两三句话：${request.context.task.canDo}` : "请用今天的词写两三句话。",
      prompt_en: "Write two or three sentences for today's task. (Practice stand-in.)",
    },
  };
}

export class FakeTutorProvider implements TutorProvider {
  readonly vendor = "Local fake tutor";
  readonly model = "fake-tutor-1";
  readonly mock = true;
  readonly paid: boolean;
  /** Every request received, for tests to inspect. */
  readonly requests: TutorRequest[] = [];
  private readonly options: FakeTutorOptions;

  constructor(options: FakeTutorOptions = {}) {
    this.options = options;
    this.paid = (options.usdPerToken ?? 0) > 0;
  }

  async generate(request: TutorRequest): Promise<TutorRawResult> {
    this.requests.push(request);
    const usage = this.options.usage ?? { tokensIn: 0, tokensOut: 0 };
    const builtIn =
      request.format?.name === LISTENING_FORMAT_NAME
        ? fakeListeningOutput(request)
        : request.format?.name === MATERIALS_FORMAT_NAME
          ? fakeMaterialsOutput(request)
          : fakeTutorOutput(request);
    const text = this.options.respond ? this.options.respond(request) : JSON.stringify(builtIn);
    return { text, usage };
  }

  estimateUsd(usage: TokenUsage): number {
    return (usage.tokensIn + usage.tokensOut) * (this.options.usdPerToken ?? 0);
  }
}

export class FakeSpeechTokenProvider implements SpeechTokenProvider {
  readonly vendor = "Local fake speech";
  readonly mock = true;
  /** How many tokens were issued, for tests. */
  issued = 0;
  private readonly fail: (() => never) | undefined;

  constructor(options: { fail?: () => never } = {}) {
    this.fail = options.fail;
  }

  async issueToken(now: Date): Promise<SpeechToken> {
    if (this.fail) this.fail();
    this.issued += 1;
    return {
      token: "fake-speech-token",
      region: "local",
      expiresAt: new Date(now.getTime() + SPEECH_TOKEN_REUSE_SECONDS * 1000).toISOString(),
    };
  }
}
