/**
 * Azure AI Speech in the browser (SPEC §7.1). The SDK is large, so it is
 * loaded only the first time speech is used. Audio goes from the browser to
 * Azure directly; nothing is recorded or kept.
 *
 * The SDK's preferred microphone path loads an audio worklet from a `blob:`
 * URL, which this app's Content-Security-Policy does not allow; the SDK then
 * uses its older ScriptProcessor path, which works the same for one utterance.
 */
import type * as SpeechSdk from "microsoft-cognitiveservices-speech-sdk";
import { MAX_SYNTHESIS_CHARS_PER_EVENT } from "../../shared/speech";
import { AZURE_VOICE, RECOGNITION_LANGUAGE, buildSsml, readConfidence, utteranceSeconds } from "./ssml";
import {
  SpeechFailure,
  type RecognitionOutcome,
  type SpeakOptions,
  type SpeakOutcome,
  type SpeechCredentials,
  type SpeechEngine,
} from "./types";

type Sdk = typeof SpeechSdk;

let sdkPromise: Promise<Sdk> | null = null;
function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import("microsoft-cognitiveservices-speech-sdk").catch((error: unknown) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

/**
 * Asks for the microphone before the SDK does, so a refusal can be told apart
 * from other failures. The stream is closed straight away; the SDK opens its own.
 */
export async function checkMicrophone(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new SpeechFailure("unsupported");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new SpeechFailure("denied");
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
      throw new SpeechFailure("no-microphone");
    }
    throw new SpeechFailure("failed");
  }
  stream.getTracks().forEach((track) => track.stop());
}

function failureFor(sdk: Sdk, code: number): SpeechFailure {
  const codes = sdk.CancellationErrorCode;
  if (code === codes.AuthenticationFailure || code === codes.Forbidden) return new SpeechFailure("token");
  if (code === codes.TooManyRequests) return new SpeechFailure("busy");
  if (code === codes.ConnectionFailure || code === codes.ServiceTimeout || code === codes.ServiceError) {
    return new SpeechFailure("network");
  }
  return new SpeechFailure("failed");
}

export class AzureSpeechEngine implements SpeechEngine {
  readonly real = true;
  private readonly credentials: () => Promise<SpeechCredentials>;

  /** `credentials` returns a current token each time; tokens expire after ten minutes. */
  constructor(credentials: () => Promise<SpeechCredentials>) {
    this.credentials = credentials;
  }

  private async config(sdk: Sdk) {
    const { token, region } = await this.credentials();
    return sdk.SpeechConfig.fromAuthorizationToken(token, region);
  }

  async recognize(signal: AbortSignal): Promise<RecognitionOutcome> {
    await checkMicrophone();
    if (signal.aborted) return { kind: "cancelled" };
    const sdk = await loadSdk();
    const config = await this.config(sdk);
    config.speechRecognitionLanguage = RECOGNITION_LANGUAGE;
    config.outputFormat = sdk.OutputFormat.Detailed;
    const recognizer = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromDefaultMicrophoneInput());
    const started = Date.now();

    try {
      return await new Promise<RecognitionOutcome>((resolve, reject) => {
        const onAbort = () => resolve({ kind: "cancelled" });
        signal.addEventListener("abort", onAbort, { once: true });
        recognizer.recognizeOnceAsync(
          (result) => {
            signal.removeEventListener("abort", onAbort);
            if (signal.aborted) return resolve({ kind: "cancelled" });
            const seconds = utteranceSeconds(result.duration, Date.now() - started);
            if (result.reason === sdk.ResultReason.RecognizedSpeech && result.text.trim()) {
              const json = result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
              resolve({ kind: "recognized", text: result.text.trim(), confidence: readConfidence(json), audioSeconds: seconds });
            } else if (result.reason === sdk.ResultReason.Canceled) {
              const details = sdk.CancellationDetails.fromResult(result);
              reject(failureFor(sdk, details.ErrorCode));
            } else {
              resolve({ kind: "no-speech", audioSeconds: seconds });
            }
          },
          () => {
            signal.removeEventListener("abort", onAbort);
            reject(new SpeechFailure("failed"));
          },
        );
      });
    } finally {
      // Closing the recognizer releases the microphone.
      recognizer.close();
    }
  }

  async synthesize(text: string, rate: number, options: SpeakOptions = {}): Promise<{ audio: ArrayBuffer; characters: number }> {
    const ssml = buildSsml(text, rate, options.voice, options.phoneme);
    const characters = Math.min(MAX_SYNTHESIS_CHARS_PER_EVENT, ssml.length);
    const sdk = await loadSdk();
    const config = await this.config(sdk);
    // No audio output: the result's audio data is returned for caching.
    const synthesizer = new sdk.SpeechSynthesizer(config, null as unknown as InstanceType<typeof sdk.AudioConfig>);
    try {
      return await new Promise((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            if (result.reason === sdk.ResultReason.Canceled) reject(failureFor(sdk, sdk.CancellationDetails.fromResult(result).ErrorCode));
            else resolve({ audio: result.audioData, characters });
          },
          () => reject(new SpeechFailure("failed")),
        );
      });
    } finally {
      synthesizer.close();
    }
  }

  async speak(text: string, rate: number, signal: AbortSignal, options: SpeakOptions = {}): Promise<SpeakOutcome> {
    const ssml = buildSsml(text, rate, options.voice, options.phoneme);
    // Counted as the whole SSML document, which errs high for the free-tier count.
    const characters = Math.min(MAX_SYNTHESIS_CHARS_PER_EVENT, ssml.length);
    const sdk = await loadSdk();
    const config = await this.config(sdk);
    config.speechSynthesisVoiceName = AZURE_VOICE;
    const player = new sdk.SpeakerAudioDestination();
    const synthesizer = new sdk.SpeechSynthesizer(config, sdk.AudioConfig.fromSpeakerOutput(player));

    const stop = () => {
      player.pause();
      player.close();
    };
    try {
      return await new Promise<SpeakOutcome>((resolve, reject) => {
        let finished = false;
        const onAbort = () => {
          stop();
          resolve({ characters, played: false });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        player.onAudioEnd = () => {
          if (finished) return;
          finished = true;
          signal.removeEventListener("abort", onAbort);
          resolve({ characters, played: true });
        };
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            if (result.reason === sdk.ResultReason.Canceled) {
              signal.removeEventListener("abort", onAbort);
              finished = true;
              reject(failureFor(sdk, sdk.CancellationDetails.fromResult(result).ErrorCode));
            }
            // Otherwise playback continues; onAudioEnd settles the promise.
          },
          () => {
            signal.removeEventListener("abort", onAbort);
            finished = true;
            reject(new SpeechFailure("failed"));
          },
        );
      });
    } finally {
      synthesizer.close();
    }
  }
}

/** The browser's own voice, offered only when Azure's cannot be used. Quality varies by device. */
export function speakWithDeviceVoice(text: string, rate: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve(false);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = Math.min(2, Math.max(0.5, rate));
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    signal.addEventListener(
      "abort",
      () => {
        window.speechSynthesis.cancel();
        resolve(false);
      },
      { once: true },
    );
    window.speechSynthesis.speak(utterance);
  });
}
