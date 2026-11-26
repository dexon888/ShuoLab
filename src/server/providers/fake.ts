/**
 * Fake providers for local development and tests. They make no network calls,
 * cost nothing, and are deterministic. They are never used in production.
 */
import { SPEECH_TOKEN_REUSE_SECONDS } from "../../shared/speech";
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
  return {
    spoken_reply_zh: target ? `好的。我们来聊聊“${target.hanzi}”吧，你觉得怎么样？` : "好的。你今天过得怎么样？",
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
  return {
    lines: [
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
    const builtIn = request.format?.name === LISTENING_FORMAT_NAME ? fakeListeningOutput(request) : fakeTutorOutput(request);
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
