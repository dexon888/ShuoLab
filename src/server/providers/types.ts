/**
 * Provider boundaries (SPEC §3 "vendor boundary"). The tutor adapter only
 * moves text: it sends authored instructions and the conversation, and hands
 * back whatever the model produced. Validating that output, retrying and
 * falling back happen in the turn service, the same way for every provider.
 */

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TutorRequest {
  /** Authored by the server. Never contains learner text. */
  instructions: string;
  /** Earlier turns, then the learner's new message last. Learner text is untrusted. */
  messages: readonly TutorMessage[];
  /** The same facts the instructions describe, as data. Used by the local stand-in. */
  context: {
    targets: readonly { id: string; hanzi: string }[];
    colloquial: readonly { id: string; term: string }[];
    /** 0 for the first turn of the session. */
    turnIndex: number;
    /** 1 for the first try, 2 for the retry after a rejected answer. */
    attempt: number;
  };
}

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface TutorRawResult {
  /** The model's text, expected to be JSON. Null when it refused or produced nothing usable. */
  text: string | null;
  usage: TokenUsage;
}

/** `quota`: the provider account has no credit or has hit its own spending limit. Waiting does not help. */
export type ProviderErrorKind = "timeout" | "network" | "rate_limited" | "quota" | "auth" | "http" | "malformed";

/**
 * A provider call that produced no answer. Carries a category only: never the
 * provider's message, a key, or any part of the prompt (SPEC §9.1).
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;

  constructor(kind: ProviderErrorKind) {
    super(`Provider call failed (${kind}).`);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

export interface TutorProvider {
  readonly vendor: string;
  readonly model: string;
  /** True for the local stand-in: no model is called. */
  readonly mock: boolean;
  /** True when calls cost money, so the monthly stop amount applies. */
  readonly paid: boolean;
  generate(request: TutorRequest): Promise<TutorRawResult>;
  /** This app's estimate of what a call cost, in US dollars. */
  estimateUsd(usage: TokenUsage): number;
}

export interface SpeechToken {
  /** Short-lived authorization token — never the resource key. */
  token: string;
  region: string;
  expiresAt: string;
}

export interface SpeechTokenProvider {
  readonly vendor: string;
  /** True for the local stand-in: its token does not work with Azure. */
  readonly mock: boolean;
  issueToken(now: Date): Promise<SpeechToken>;
}
