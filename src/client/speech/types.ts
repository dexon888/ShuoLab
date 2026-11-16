/** What one tap of "Speak" produced. */
export type RecognitionOutcome =
  | {
      kind: "recognized";
      text: string;
      /** Azure's confidence from 0 to 1, when it gives one. */
      confidence: number | null;
      /** How long the microphone was open, for the free-tier count. */
      audioSeconds: number;
    }
  | { kind: "no-speech"; audioSeconds: number }
  | { kind: "cancelled" };

export interface SpeakOutcome {
  /** Characters sent for synthesis, for the free-tier count. */
  characters: number;
  /** False for the stand-in, which plays nothing. */
  played: boolean;
}

/**
 * Why speech did not work. Each has its own message, and none of them stops
 * the session: typing always works.
 */
export type SpeechFailureKind =
  | "denied"
  | "no-microphone"
  | "unsupported"
  | "token"
  | "busy"
  | "network"
  | "failed";

export class SpeechFailure extends Error {
  readonly kind: SpeechFailureKind;

  constructor(kind: SpeechFailureKind) {
    super(`Speech failed (${kind}).`);
    this.name = "SpeechFailure";
    this.kind = kind;
  }
}

export interface SpeechCredentials {
  token: string;
  region: string;
}

export interface SpeechEngine {
  /** False for the local stand-in: nothing is recorded or played, and nothing is counted. */
  readonly real: boolean;
  /** Listens for one utterance; stops by itself at a pause. Abort to cancel. */
  recognize(signal: AbortSignal): Promise<RecognitionOutcome>;
  /** Speaks a reply aloud at the given rate (1 is normal). Abort to stop. */
  speak(text: string, rate: number, signal: AbortSignal): Promise<SpeakOutcome>;
}
