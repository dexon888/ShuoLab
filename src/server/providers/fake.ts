/**
 * Fake providers for local development and tests. They make no network calls,
 * cost nothing, and are deterministic. They are never used in production.
 */
import type {
  SpeechToken,
  SpeechTokenProvider,
  TutorProvider,
  TutorTurnInput,
  TutorTurnOutput,
} from "./types";

export class FakeTutorProvider implements TutorProvider {
  readonly vendor = "fake";
  readonly model = "fake-tutor-1";

  async generateTurn(input: TutorTurnInput): Promise<TutorTurnOutput> {
    const first = input.targetWords[0];
    return {
      spokenReplyZh: first ? `好的。我们来聊聊“${first.hanzi}”吧？` : "好的。你今天过得怎么样？",
      referencedCurriculumItemIds: first ? [first.id] : [],
      usage: { tokensIn: 0, tokensOut: 0 },
    };
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
