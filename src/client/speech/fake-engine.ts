/**
 * The local stand-in for speech, used when the server hands out a stand-in
 * token (no Azure settings, development and tests only). It never opens the
 * microphone and plays nothing; it pretends to hear a fixed sentence.
 *
 * Browser tests can script what it "hears" through `window.__shuolabFakeSpeech`.
 */
import { SpeechFailure, type AssessmentOutcome, type RecognitionOutcome, type SpeakOptions, type SpeakOutcome, type SpeechEngine, type SpeechFailureKind } from "./types";

export interface FakeRecognition {
  text?: string;
  confidence?: number | null;
  seconds?: number;
  noSpeech?: boolean;
  error?: SpeechFailureKind;
}

export interface FakeSpeechScript {
  recognitions?: FakeRecognition[];
  /** Scores for scripted pronunciation attempts, in order; otherwise every character scores 85. */
  assessments?: { accuracy: number; weak?: string[] }[];
  /** Every text the stand-in was asked to speak, for tests to read. */
  spoken?: string[];
}

declare global {
  interface Window {
    __shuolabFakeSpeech?: FakeSpeechScript;
  }
}

export const FAKE_TRANSCRIPT = "你好，我想练习说中文。";

function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => resolve(true), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export class FakeSpeechEngine implements SpeechEngine {
  readonly real = false;
  private readonly delayMs: number;

  constructor(delayMs = 300) {
    this.delayMs = delayMs;
  }

  async recognize(signal: AbortSignal): Promise<RecognitionOutcome> {
    const next = typeof window === "undefined" ? undefined : window.__shuolabFakeSpeech?.recognitions?.shift();
    if (!(await wait(this.delayMs, signal))) return { kind: "cancelled" };
    if (next?.error) throw new SpeechFailure(next.error);
    if (next?.noSpeech) return { kind: "no-speech", audioSeconds: next.seconds ?? 3 };
    return {
      kind: "recognized",
      text: next?.text ?? FAKE_TRANSCRIPT,
      confidence: next?.confidence === undefined ? 0.92 : next.confidence,
      audioSeconds: next?.seconds ?? 2.4,
    };
  }

  async assess(referenceText: string, signal: AbortSignal): Promise<AssessmentOutcome> {
    const next = typeof window === "undefined" ? undefined : window.__shuolabFakeSpeech?.assessments?.shift();
    await wait(this.delayMs, signal);
    if (signal.aborted) return { kind: "cancelled" };
    const accuracy = next?.accuracy ?? 85;
    const words = [...referenceText].filter((c) => /\p{Script=Han}/u.test(c)).map((c) => ({ text: c, accuracy: next?.weak?.includes(c) ? 40 : accuracy, error: next?.weak?.includes(c) ? "Mispronunciation" : "None" }));
    return { kind: "assessed", scores: { accuracy, fluency: accuracy, completeness: 100, pronunciation: accuracy }, words, recognized: referenceText, audioSeconds: 3 };
  }

  async synthesize(text: string, _rate: number, options: SpeakOptions = {}): Promise<{ audio: ArrayBuffer; characters: number }> {
    if (typeof window !== "undefined") {
      const script = (window.__shuolabFakeSpeech ??= {});
      (script.spoken ??= []).push(options.voice ? `${text} [${options.voice}]` : text);
    }
    return { audio: new ArrayBuffer(0), characters: text.length };
  }

  async speak(text: string, _rate: number, signal: AbortSignal, options: SpeakOptions = {}): Promise<SpeakOutcome> {
    if (typeof window !== "undefined") {
      const script = (window.__shuolabFakeSpeech ??= {});
      (script.spoken ??= []).push(options.voice ? `${text} [${options.voice}]` : text);
    }
    await wait(this.delayMs, signal);
    return { characters: text.length, played: false };
  }
}
