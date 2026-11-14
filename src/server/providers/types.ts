/**
 * Provider boundaries (SPEC §3 "vendor boundary"). Phase 0 ships the
 * interfaces and local fakes only; the OpenAI and Azure adapters are added in
 * Phases 2 and 3 and are selected at runtime from environment secrets.
 */

export interface TutorTurnInput {
  learnerText: string;
  /** Real words from imported curriculum rows, chosen by the planner. */
  targetWords: readonly { id: string; hanzi: string }[];
}

export interface TutorTurnOutput {
  spokenReplyZh: string;
  referencedCurriculumItemIds: string[];
  usage: { tokensIn: number; tokensOut: number };
}

export interface TutorProvider {
  readonly vendor: string;
  readonly model: string;
  generateTurn(input: TutorTurnInput): Promise<TutorTurnOutput>;
}

export interface SpeechToken {
  /** Short-lived authorization token — never the resource key. */
  token: string;
  region: string;
  expiresAt: string;
}

export interface SpeechTokenProvider {
  readonly vendor: string;
  issueToken(now: Date): Promise<SpeechToken>;
}
