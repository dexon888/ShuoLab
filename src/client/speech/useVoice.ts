import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { audioKey, getCachedAudio, playAudio, putCachedAudio } from "./audio-cache";
import { speechUsageResponseSchema, type SpeechAllowance, type SpeechTokenResponse } from "../../shared/speech";
import { turnEventResponseSchema, type Turn, type TurnEvent } from "../../shared/tutor";
import { ApiRequestError, apiPost } from "../lib/api";
import { AzureSpeechEngine, speakWithDeviceVoice } from "./azure-engine";
import { FakeSpeechEngine } from "./fake-engine";
import { SpeechTokenSource } from "./token";
import { startLocalRecording, type LocalRecording } from "./local-recording";
import { SpeechFailure, type RecognitionOutcome, type SpeechEngine, type SpeechFailureKind, type AssessmentOutcome } from "./types";

export interface SpeechEnvironment {
  /** Whether this browser can record at all: a secure page with microphone access. */
  canRecord: () => boolean;
  createEngine: (token: SpeechTokenResponse, source: SpeechTokenSource) => SpeechEngine;
  createTokenSource: () => SpeechTokenSource;
}

export const defaultSpeechEnvironment: SpeechEnvironment = {
  canRecord: () =>
    typeof window !== "undefined" && window.isSecureContext && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
  createEngine: (token, source) =>
    token.mock
      ? new FakeSpeechEngine()
      : new AzureSpeechEngine(async () => {
          const current = await source.get();
          return { token: current.token, region: current.region };
        }),
  // One token for the whole page: every step and panel that speaks or listens
  // shares it, so moving through a lesson doesn't use up the per-minute limit.
  createTokenSource: () => (sharedTokenSource ??= new SpeechTokenSource()),
};
let sharedTokenSource: SpeechTokenSource | null = null;

/** Tests replace the engines and the browser checks here. */
export const SpeechEnvironmentContext = createContext<SpeechEnvironment>(defaultSpeechEnvironment);

export type VoicePhase = "idle" | "starting" | "listening" | "speaking";

export type VoiceProblem =
  | { kind: SpeechFailureKind }
  | { kind: "no-speech" }
  | { kind: "server"; message: string; retryable: boolean };

export interface VoiceState {
  phase: VoicePhase;
  /** The turn whose reply is being spoken, if any. */
  speakingTurnId: string | null;
  problem: VoiceProblem | null;
  /** From the latest token: what is left of this month's free speech. */
  allowance: SpeechAllowance | null;
  /** True once a token came from the stand-in issuer: nothing real is heard or played. */
  standIn: boolean;
  /** The reply whose Azure voice failed, which the device voice may read instead. */
  deviceVoiceOffer: string | null;
}

const IDLE: VoiceState = { phase: "idle", speakingTurnId: null, problem: null, allowance: null, standIn: false, deviceVoiceOffer: null };

function problemFrom(error: unknown): VoiceProblem {
  if (error instanceof SpeechFailure) return { kind: error.kind };
  if (error instanceof ApiRequestError) return { kind: "server", message: error.message, retryable: error.retryable };
  return { kind: "failed" };
}

/**
 * Speaking and listening for one session. Microphone and playback are
 * released when the learner stops, leaves the page, or the app goes to the
 * background (SPEC §7.1 step 8, §7.4).
 */
/** `sessionId` is null outside a session, such as on the Review page. */
export function useVoice(sessionId: string | null, rate: number) {
  const env = useContext(SpeechEnvironmentContext);
  const [state, setState] = useState<VoiceState>(IDLE);
  const sourceRef = useRef<SpeechTokenSource | null>(null);
  const engineRef = useRef<SpeechEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const source = useCallback(() => {
    sourceRef.current ??= env.createTokenSource();
    return sourceRef.current;
  }, [env]);

  /** A current token and an engine for it; the engine is made once. */
  const ready = useCallback(async () => {
    const token = await source().get();
    engineRef.current ??= env.createEngine(token, source());
    setState((s) => ({ ...s, allowance: token.allowance, standIn: token.mock }));
    return { token, engine: engineRef.current };
  }, [env, source]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, phase: "idle", speakingTurnId: null }));
  }, []);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", stop);
      abortRef.current?.abort();
    };
  }, [stop]);

  /** Counts real use against the free allowance. A lost report is not worth interrupting the learner for. */
  const report = useCallback(
    async (body: { kind: "recognition"; audioSeconds: number } | { kind: "synthesis"; characters: number }) => {
      try {
        const result = await apiPost("/speech/usage", { clientEventId: crypto.randomUUID(), ...(sessionId ? { sessionId } : {}), ...body }, speechUsageResponseSchema);
        source().setAllowance(result.allowance);
        setState((s) => ({ ...s, allowance: result.allowance }));
      } catch {
        // The next token carries the server's count.
      }
    },
    [sessionId, source],
  );

  const recordEvent = useCallback(
    (turnId: string, event: TurnEvent) => {
      if (!sessionId) return;
      void apiPost(`/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/events`, { event }, turnEventResponseSchema).catch(
        () => undefined,
      );
    },
    [sessionId],
  );

  /**
   * Scores the learner reading `text` aloud (SPEC §7.3). Counted against the
   * recognition allowance like any listening. Null when nothing was heard.
   * With `keepCopy`, a real engine's attempt is also recorded into memory for
   * listening back; it is never uploaded. The stand-in never opens the microphone.
   */
  const assess = useCallback(
    async (text: string, options: { keepCopy?: boolean } = {}): Promise<(Extract<AssessmentOutcome, { kind: "assessed" }> & { mine: Blob | null }) | null> => {
      let recording: Promise<LocalRecording | null> = Promise.resolve(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({ ...s, phase: "starting", problem: null, speakingTurnId: null, deviceVoiceOffer: null }));
      try {
        const { token, engine } = await ready();
        if (!token.allowance.recognitionAvailable) {
          setState((s) => ({ ...s, phase: "idle" }));
          return null;
        }
        setState((s) => ({ ...s, phase: "listening" }));
        if (options.keepCopy && engine.real) recording = startLocalRecording();
        const outcome = await engine.assess(text, controller.signal);
        const mine = (await (await recording)?.stop()) ?? null;
        if (engine.real && outcome.kind !== "cancelled") void report({ kind: "recognition", audioSeconds: outcome.audioSeconds });
        setState((s) => ({ ...s, phase: "idle", problem: outcome.kind === "no-speech" ? { kind: "no-speech" } : null }));
        return outcome.kind === "assessed" ? { ...outcome, mine } : null;
      } catch (error) {
        void (await recording)?.stop();
        setState((s) => ({ ...s, phase: "idle", problem: problemFrom(error) }));
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [ready, report],
  );

  /** Listens for one utterance. Returns null when nothing usable was heard. */
  const listen = useCallback(async (): Promise<RecognitionOutcome | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, phase: "starting", problem: null, speakingTurnId: null, deviceVoiceOffer: null }));
    try {
      const { token, engine } = await ready();
      if (!token.allowance.recognitionAvailable) {
        setState((s) => ({ ...s, phase: "idle" }));
        return null;
      }
      setState((s) => ({ ...s, phase: "listening" }));
      let outcome: RecognitionOutcome;
      try {
        outcome = await engine.recognize(controller.signal);
      } catch (error) {
        // An expired or refused token gets one fresh try.
        if (!(error instanceof SpeechFailure && error.kind === "token")) throw error;
        source().invalidate();
        await source().get();
        outcome = await engine.recognize(controller.signal);
      }
      if (engine.real && outcome.kind !== "cancelled") void report({ kind: "recognition", audioSeconds: outcome.audioSeconds });
      setState((s) => ({ ...s, phase: "idle", problem: outcome.kind === "no-speech" ? { kind: "no-speech" } : null }));
      return outcome.kind === "recognized" ? outcome : null;
    } catch (error) {
      setState((s) => ({ ...s, phase: "idle", problem: problemFrom(error) }));
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [ready, report, source]);

  /**
   * Reads any Mandarin text aloud. `key` names what is playing (a turn id, or
   * "listening"); `onPlayed` runs when a real voice finished playing it.
   */
  const speakText = useCallback(
    async (key: string, text: string, options: { rate?: number; onPlayed?: () => void; voice?: string; phoneme?: string } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({ ...s, phase: "starting", problem: null, speakingTurnId: key, deviceVoiceOffer: null }));
      try {
        const { token, engine } = await ready();
        if (!token.allowance.synthesisAvailable) {
          setState((s) => ({ ...s, phase: "idle", speakingTurnId: null }));
          return;
        }
        setState((s) => ({ ...s, phase: "speaking" }));
        const outcome = await engine.speak(text, options.rate ?? rate, controller.signal, { voice: options.voice, phoneme: options.phoneme });
        if (engine.real) {
          void report({ kind: "synthesis", characters: outcome.characters });
          if (outcome.played) options.onPlayed?.();
        }
        setState((s) => ({ ...s, phase: "idle", speakingTurnId: null }));
      } catch (error) {
        const problem = problemFrom(error);
        const offer = error instanceof SpeechFailure && "speechSynthesis" in window ? key : null;
        setState((s) => ({ ...s, phase: "idle", speakingTurnId: null, problem, deviceVoiceOffer: offer }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [rate, ready, report],
  );

  /** Reads a reply aloud. Records the first time a real voice played it. */
  const speak = useCallback(
    (turn: Turn) => speakText(turn.turnId, turn.reply.spokenZh, { onPlayed: () => recordEvent(turn.turnId, "played") }),
    [recordEvent, speakText],
  );

  /** The device's own voice, when Azure's failed. Not counted against Azure. */
  const speakTextOnDevice = useCallback(
    async (key: string, text: string, options: { rate?: number; onPlayed?: () => void } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({ ...s, phase: "speaking", speakingTurnId: key, problem: null, deviceVoiceOffer: null }));
      const played = await speakWithDeviceVoice(text, options.rate ?? rate, controller.signal);
      if (played) options.onPlayed?.();
      setState((s) => ({ ...s, phase: "idle", speakingTurnId: null }));
      if (abortRef.current === controller) abortRef.current = null;
    },
    [rate],
  );

  const speakOnDevice = useCallback(
    (turn: Turn) => speakTextOnDevice(turn.turnId, turn.reply.spokenZh, { onPlayed: () => recordEvent(turn.turnId, "played") }),
    [recordEvent, speakTextOnDevice],
  );

  /**
   * Plays text from the device cache, synthesizing and caching it the first
   * time (SPEC §5.10). Only a fresh synthesis is counted against the allowance.
   */
  const speakCached = useCallback(
    async (key: string, text: string, options: { rate?: number; voice: string }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({ ...s, phase: "starting", problem: null, speakingTurnId: key, deviceVoiceOffer: null }));
      try {
        const r = options.rate ?? rate;
        const cacheKey = await audioKey(text, options.voice, r);
        let audio = await getCachedAudio(cacheKey);
        if (!audio) {
          const { token, engine } = await ready();
          if (!token.allowance.synthesisAvailable) {
            setState((s) => ({ ...s, phase: "idle", speakingTurnId: null }));
            return;
          }
          const made = await engine.synthesize(text, r, { voice: options.voice });
          if (engine.real) void report({ kind: "synthesis", characters: made.characters });
          audio = made.audio;
          await putCachedAudio(cacheKey, audio);
        }
        setState((s) => ({ ...s, phase: "speaking" }));
        await playAudio(audio, controller.signal);
        setState((s) => ({ ...s, phase: "idle", speakingTurnId: null }));
      } catch (error) {
        setState((s) => ({ ...s, phase: "idle", speakingTurnId: null, problem: problemFrom(error) }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [rate, ready, report],
  );

  const reveal = useCallback((turnId: string) => recordEvent(turnId, "revealed"), [recordEvent]);
  const clearProblem = useCallback(() => setState((s) => ({ ...s, problem: null, deviceVoiceOffer: null })), []);

  return { state, canRecord: env.canRecord(), listen, assess, speak, speakText, speakCached, speakOnDevice, speakTextOnDevice, stop, reveal, clearProblem };
}
