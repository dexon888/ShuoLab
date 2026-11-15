/**
 * Fake providers for local development and tests. They make no network calls,
 * cost nothing, and are deterministic. They are never used in production.
 */
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
    const text = this.options.respond ? this.options.respond(request) : JSON.stringify(fakeTutorOutput(request));
    return { text, usage };
  }

  estimateUsd(usage: TokenUsage): number {
    return (usage.tokensIn + usage.tokensOut) * (this.options.usdPerToken ?? 0);
  }
}

export class FakeSpeechTokenProvider implements SpeechTokenProvider {
  readonly vendor = "fake";

  async issueToken(now: Date): Promise<SpeechToken> {
    return {
      token: "fake-speech-token",
      region: "local",
      expiresAt: new Date(now.getTime() + 9 * 60_000).toISOString(),
    };
  }
}
