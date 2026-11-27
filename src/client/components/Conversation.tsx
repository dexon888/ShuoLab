import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { ProviderStatus } from "../../shared/api";
import type { SessionDetail } from "../../shared/session";
import type { DisplayMode } from "../../shared/settings";
import { MAX_TRANSCRIPT_CHARS, type Turn } from "../../shared/tutor";
import { useCompleteSession, useSendTurn, useSession, useSessionAction, type OutgoingTurn } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { loadDraft, saveDraft, type SessionDraft } from "../lib/draft";
import { CONFIDENT_RECOGNITION } from "../speech/ssml";
import { problemText } from "../speech/problems";
import { useVoice } from "../speech/useVoice";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

/** Per-viewer conveniences, kept in this browser only. */
function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The choice simply will not be remembered.
  }
}

interface ReplyAudio {
  /** Null when speech is not available at all. */
  onPlay: (() => void) | null;
  onStop: () => void;
  playing: boolean;
  onDeviceVoice: (() => void) | null;
}

interface TutorReplyProps {
  turn: Turn;
  displayMode: DisplayMode;
  words: ReadonlyMap<string, string>;
  audio: ReplyAudio;
  /** Listen first: the text stays hidden until the learner asks for it. */
  hidden: boolean;
  onReveal: () => void;
}

/** The tutor's side of one turn: characters first, help only as the settings or the learner ask. */
function TutorReply({ turn, displayMode, words, audio, hidden, onReveal }: TutorReplyProps) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const showEnglish = chosen ?? displayMode === "hanzi_pinyin_english";
  const { reply } = turn;
  const used = turn.referencedCurriculumItemIds.map((id) => words.get(id)).filter((w): w is string => w !== undefined);

  return (
    <div className="mt-3 border-l-4 border-cobalt bg-wash px-4 py-3">
      <p className="text-sm font-semibold text-cobalt-deep">Tutor</p>
      {hidden ? (
        <div className="mt-1">
          <p className="text-mist">Text hidden so you can listen first.</p>
          <button type="button" onClick={onReveal} className="mt-1 min-h-11 font-medium text-cobalt underline">
            Show text
          </button>
        </div>
      ) : (
        <>
          <p lang="zh-Hans" className="mt-1 text-xl leading-relaxed break-words">
            {reply.spokenZh}
          </p>
          {displayMode !== "hanzi" && reply.pinyin ? <p className="mt-1 text-mist break-words">{reply.pinyin}</p> : null}
          {reply.translationEn ? (
            <div className="mt-2">
              {showEnglish ? <p className="break-words">{reply.translationEn}</p> : null}
              <button
                type="button"
                aria-expanded={showEnglish}
                onClick={() => setChosen(!showEnglish)}
                className="mt-1 min-h-11 font-medium text-cobalt underline"
              >
                {showEnglish ? "Hide English" : "Show English"}
              </button>
            </div>
          ) : null}
        </>
      )}
      {audio.onPlay ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {audio.playing ? (
            <button type="button" onClick={audio.onStop} className="min-h-11 rounded-md border border-ink px-4 font-medium">
              Stop
            </button>
          ) : (
            <button type="button" onClick={audio.onPlay} className="min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt">
              Play
            </button>
          )}
          {audio.onDeviceVoice ? (
            <button type="button" onClick={audio.onDeviceVoice} className="min-h-11 rounded-md border border-ink px-4 font-medium">
              Play with this device's voice
            </button>
          ) : null}
        </div>
      ) : null}
      {audio.onDeviceVoice ? (
        <p className="mt-1 text-sm text-mist">The device's own voice is not Azure's; its quality varies by phone and browser.</p>
      ) : null}
      {turn.fallback ? (
        <p className="mt-2 text-sm text-mist">
          Prepared reply. The tutor's own answer could not be used, so no feedback was recorded for this turn.
        </p>
      ) : null}
      {used.length > 0 && !hidden ? (
        <p className="mt-2 text-sm text-mist">
          From today's words: <span lang="zh-Hans">{used.join("、")}</span>
        </p>
      ) : null}
      {turn.coverage && turn.coverage.total > 0 && !hidden ? (
        <p className="mt-1 text-xs text-mist">
          You had met {turn.coverage.known} of the {turn.coverage.total} words in this reply.
        </p>
      ) : null}
    </div>
  );
}

interface ConversationProps {
  session: SessionDetail;
  turns: readonly Turn[];
  displayMode: DisplayMode;
  /** From Settings: 1 is normal speed. */
  speechRate: number;
  tutor: ProviderStatus | null;
  /** Null when not known; mode "missing" hides speech entirely. */
  speech?: ProviderStatus | null;
}

const READ_ALOUD_KEY = "shuolab:read-aloud";
const LISTEN_FIRST_KEY = "shuolab:listen-first";

/** The conversation for one session: saved turns, typing or speaking, and pause and finish. */
export function Conversation({ session, turns, displayMode, speechRate, tutor, speech = null }: ConversationProps) {
  const sessionId = session.id;
  const send = useSendTurn(sessionId);
  const action = useSessionAction(sessionId);
  const complete = useCompleteSession(sessionId);
  const saved = useSession(sessionId);
  const voice = useVoice(sessionId, speechRate);

  const [draft, setDraftState] = useState<SessionDraft>(() => loadDraft(sessionId));
  const [softLimit, setSoftLimit] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [readAloud, setReadAloud] = useState(() => loadFlag(READ_ALOUD_KEY, true));
  const [listenFirst, setListenFirst] = useState(() => loadFlag(LISTEN_FIRST_KEY, false));
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const boxId = useId();
  const helpId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const refocus = useRef(false);

  const setDraft = (next: SessionDraft) => {
    setDraftState(next);
    saveDraft(sessionId, next);
  };

  const words = new Map(session.plan.targets.map((t) => [t.itemId, t.hanzi]));
  const ended = session.status === "complete" || session.status === "abandoned";
  const paused = session.status === "paused";
  // A sent message that the server already has is no longer pending.
  const delivered = draft.pending !== null && turns.some((t) => t.clientTurnId === draft.pending?.clientTurnId);
  const pending = delivered ? null : draft.pending;
  const waiting = send.isPending;
  const unsent = pending !== null && !waiting;

  // Without a known speech service (still loading, or not set up) the conversation is typed only.
  const speechOff = speech === null || speech.mode === "missing";
  const { phase, problem, allowance, speakingTurnId, deviceVoiceOffer } = voice.state;
  const recognitionLeft = allowance?.recognitionAvailable ?? true;
  const synthesisLeft = allowance?.synthesisAvailable ?? true;
  const canSpeak = !speechOff && voice.canRecord && !paused && !ended;
  const canPlay = !speechOff && synthesisLeft;
  const busyListening = phase === "starting" || phase === "listening";
  const { stop } = voice;

  useEffect(() => {
    // Forget a stored message once the server has it, so a reload does not offer to resend it.
    if (delivered) saveDraft(sessionId, { text: draft.text, pending: null, fromSpeech: draft.fromSpeech });
  }, [delivered, sessionId, draft.text, draft.fromSpeech]);

  useEffect(() => {
    // Not smooth: nothing moves for people who ask for reduced motion.
    endRef.current?.scrollIntoView?.({ block: "nearest" });
    if (refocus.current && !waiting) {
      refocus.current = false;
      boxRef.current?.focus();
    }
  }, [turns.length, waiting]);

  useEffect(() => {
    // Pausing or finishing releases the microphone and stops any playback.
    if (paused || ended) stop();
  }, [paused, ended, stop]);

  const deliver = (message: OutgoingTurn) => {
    send.mutate(message, {
      onSuccess: (result) => {
        setSoftLimit(result.usage.softLimitReached);
        setDraft({ text: "", pending: null });
        refocus.current = true;
        if (!result.replayed && readAloud && canPlay) void voice.speak(result.turn);
      },
    });
  };

  const sendMessage = (transcript: string, sourceMode: "speech" | "typed", asrUncertain: boolean) => {
    const message = { clientTurnId: crypto.randomUUID(), transcript, sourceMode, asrUncertain };
    setDraft({ text: "", pending: message });
    deliver(message);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const transcript = draft.text.trim();
    if (!transcript || waiting || pending || paused || ended) return;
    // Words that came from unsure speech recognition stay speech, marked unsure, even after checking.
    sendMessage(transcript, draft.fromSpeech ? "speech" : "typed", draft.fromSpeech === true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter makes a new line. Enter that confirms an input-method choice does neither.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const startSpeaking = async () => {
    if (waiting || pending || busyListening) return;
    const outcome = await voice.listen();
    if (outcome?.kind !== "recognized") return;
    if (outcome.confidence === null || outcome.confidence >= CONFIDENT_RECOGNITION) {
      sendMessage(outcome.text, "speech", false);
    } else {
      // Not sure what it heard: let the learner check before sending (SPEC §7.4).
      setDraft({ text: outcome.text, pending: null, fromSpeech: true });
      boxRef.current?.focus();
    }
  };

  /** Puts an unsent message back in the box, unless the server turns out to have it. */
  const editInstead = async () => {
    if (!pending) return;
    const latest = await saved.refetch();
    const arrived = latest.data?.turns.some((t) => t.clientTurnId === pending.clientTurnId) ?? false;
    send.reset();
    setDraft(
      arrived
        ? { text: "", pending: null }
        : { text: pending.transcript, pending: null, fromSpeech: pending.sourceMode === "speech" && pending.asrUncertain === true },
    );
    boxRef.current?.focus();
  };

  const reveal = (turn: Turn) => {
    setRevealed((current) => new Set(current).add(turn.turnId));
    if (!turn.listening.revealedAt) voice.reveal(turn.turnId);
  };

  const toggleReadAloud = (value: boolean) => {
    setReadAloud(value);
    saveFlag(READ_ALOUD_KEY, value);
    if (!value) stop();
  };

  const toggleListenFirst = (value: boolean) => {
    setListenFirst(value);
    saveFlag(LISTEN_FIRST_KEY, value);
  };

  const newestId = turns.at(-1)?.turnId ?? null;
  const sendError = send.error;
  const overBudget = sendError instanceof ApiRequestError && sendError.code === "BUDGET_EXCEEDED";
  const canRetry = !(sendError instanceof ApiRequestError) || sendError.retryable || sendError.code === "CONFLICT";
  const controlError = action.error ?? complete.error;
  const remaining = MAX_TRANSCRIPT_CHARS - draft.text.length;

  const status = waiting
    ? "The tutor is replying…"
    : phase === "starting"
      ? speakingTurnId
        ? "Getting the voice ready…"
        : "Starting the microphone…"
      : phase === "listening"
        ? "Listening. Speak now; it stops when you pause."
        : phase === "speaking"
          ? "Speaking the reply…"
          : "";

  return (
    <div>
      {tutor?.mode === "mock" ? (
        <p className="mb-4 border-l-4 border-line bg-wash px-4 py-3">
          <span className="font-semibold">Practice stand-in tutor.</span> These replies are prepared
          sentences, not a language model, and they do not respond to what you write. Nothing is
          sent out and nothing is billed.
        </p>
      ) : null}
      {tutor?.mode === "missing" ? (
        <p className="mb-4 border-l-4 border-seal bg-seal-wash px-4 py-3">
          <span className="font-semibold">The tutor is not set up.</span> {tutor.setupHint}
        </p>
      ) : null}
      {speech?.mode === "mock" && !ended ? (
        <p className="mb-4 border-l-4 border-line bg-wash px-4 py-3">
          <span className="font-semibold">Practice stand-in speech.</span> It does not use the
          microphone or play any sound: Speak pretends you said a fixed sentence, and Play shows the
          reply without a voice.
        </p>
      ) : null}

      {turns.length === 0 && !ended ? (
        <p className="mb-4 text-mist">
          Start with a sentence or two in Chinese about the situation above, by speaking or typing.
          The tutor answers in Chinese and asks one question back. Corrections wait for the summary
          at the end.
        </p>
      ) : null}

      <ol aria-label="Conversation so far" className="space-y-6">
        {turns.map((turn) => {
          const hidden =
            listenFirst && readAloud && canPlay && turn.turnId === newestId && !revealed.has(turn.turnId) && !turn.listening.revealedAt;
          return (
            <li key={turn.turnId}>
              <div className="px-4">
                <p className="text-sm font-semibold text-mist">
                  You <span className="font-normal">({turn.sourceMode === "typed" ? "typed" : "spoken"})</span>
                </p>
                <p lang="zh-Hans" className="mt-1 text-xl leading-relaxed break-words whitespace-pre-wrap">
                  {turn.learnerText}
                </p>
              </div>
              <TutorReply
                turn={turn}
                displayMode={displayMode}
                words={words}
                hidden={hidden}
                onReveal={() => reveal(turn)}
                audio={{
                  onPlay: canPlay ? () => void voice.speak(turn) : null,
                  onStop: stop,
                  playing: speakingTurnId === turn.turnId,
                  onDeviceVoice: deviceVoiceOffer === turn.turnId ? () => void voice.speakOnDevice(turn) : null,
                }}
              />
            </li>
          );
        })}
      </ol>

      {pending ? (
        <div className="mt-6 px-4">
          <p className="text-sm font-semibold text-mist">You ({pending.sourceMode === "speech" ? "spoken" : "typed"})</p>
          <p lang="zh-Hans" className="mt-1 text-xl leading-relaxed break-words whitespace-pre-wrap">
            {pending.transcript}
          </p>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="mt-3 min-h-6 px-4 text-mist">
        {status}
      </p>

      {problem ? (
        <div role="alert" className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-3">
          <p>{problemText(problem)}</p>
          <button type="button" onClick={voice.clearProblem} className="mt-2 min-h-11 font-medium text-cobalt underline">
            Dismiss
          </button>
        </div>
      ) : null}

      {unsent ? (
        <div role="alert" className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-3">
          <p className="font-semibold">{sendError ? "That message was not answered." : "This message may not have been sent."}</p>
          <p className="mt-1">
            {sendError ? errorText(sendError) : "The page was reloaded before the tutor's answer arrived."} Your message is kept
            above.
          </p>
          {overBudget ? (
            <p className="mt-1">
              <Link to="/settings" className="font-medium text-cobalt underline">
                Open Settings to see or change the amount
              </Link>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            {canRetry && !paused && !ended ? (
              <button type="button" onClick={() => deliver(pending)} className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze">
                Send again
              </button>
            ) : null}
            <button type="button" onClick={() => void editInstead()} className="min-h-11 rounded-md border border-ink px-4 font-medium">
              Edit message
            </button>
          </div>
        </div>
      ) : null}

      {softLimit ? (
        <p className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-2 text-sm">
          This month's estimated spending has reached your warning amount.{" "}
          <Link to="/settings" className="font-medium text-cobalt underline">
            See Settings
          </Link>
        </p>
      ) : null}

      <div ref={endRef} />

      {ended ? null : paused ? (
        <div className="mt-6 border-l-4 border-jade bg-jade-wash px-4 py-3">
          <p className="font-semibold">Paused</p>
          <p className="mt-1 text-mist">Paused time is not counted as practice. Your conversation is saved.</p>
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => action.mutate("resume")}
            className="mt-3 min-h-12 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60"
          >
            Resume
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6">
          {draft.fromSpeech && draft.text ? (
            <p className="mb-2 border-l-4 border-seal bg-seal-wash px-4 py-2">
              Speech recognition wasn't sure it heard this right. Check the text below, correct it if
              needed, then send.
            </p>
          ) : null}
          <label htmlFor={boxId} className="block font-medium">
            Your reply in Chinese
          </label>
          <textarea
            id={boxId}
            ref={boxRef}
            lang="zh-Hans"
            rows={3}
            maxLength={MAX_TRANSCRIPT_CHARS}
            value={draft.text}
            onChange={(event) =>
              setDraft({ text: event.target.value, pending, fromSpeech: event.target.value === "" ? false : draft.fromSpeech })
            }
            onKeyDown={onKeyDown}
            aria-describedby={helpId}
            className="mt-1 w-full rounded-md border border-line bg-glaze px-3 py-2 text-xl"
          />
          <p id={helpId} className="mt-1 text-sm text-mist">
            Enter sends. Shift+Enter starts a new line.
            {remaining <= 200 ? ` ${remaining} characters left.` : ""} Typing is writing practice; it is not counted as
            speaking.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {canSpeak ? (
              busyListening && !speakingTurnId ? (
                <button
                  type="button"
                  onClick={stop}
                  className="min-h-12 w-full rounded-md border-2 border-seal px-5 text-lg font-semibold text-seal sm:w-auto"
                >
                  Stop listening
                </button>
              ) : (
                <button
                  type="button"
                  disabled={waiting || pending !== null || !recognitionLeft}
                  onClick={() => void startSpeaking()}
                  className="min-h-12 w-full rounded-md bg-jade px-5 text-lg font-semibold text-glaze disabled:opacity-60 sm:w-auto"
                >
                  Speak
                </button>
              )
            ) : null}
            <button
              type="submit"
              disabled={waiting || pending !== null || draft.text.trim() === "" || busyListening}
              className="min-h-12 w-full rounded-md bg-cobalt px-5 text-lg font-semibold text-glaze hover:bg-cobalt-deep disabled:opacity-60 sm:w-auto"
            >
              Send
            </button>
          </div>
          {!speechOff && !voice.canRecord ? (
            <p className="mt-2 text-sm text-mist">
              Speaking needs a secure (https) page and microphone access in this browser. Typing works everywhere.
            </p>
          ) : null}
          {canSpeak && !recognitionLeft ? (
            <p className="mt-2 text-sm text-mist">This month's free speech recognition is used up. Answer by typing until next month.</p>
          ) : null}
          {speechOff ? (
            speech?.mode === "missing" ? (
              <p className="mt-2 text-sm text-mist">Speech is not set up, so this conversation is typed. {speech.setupHint}</p>
            ) : null
          ) : (
            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Listening options</legend>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={readAloud}
                  onChange={(event) => toggleReadAloud(event.target.checked)}
                  className="h-5 w-5"
                />
                Read replies aloud
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={listenFirst}
                  disabled={!readAloud}
                  onChange={(event) => toggleListenFirst(event.target.checked)}
                  className="h-5 w-5"
                />
                Listen first: hide the newest reply's text until I choose to see it
              </label>
              {!synthesisLeft ? (
                <p className="text-sm text-mist">This month's free spoken replies are used up. Replies are shown as text until next month.</p>
              ) : null}
            </fieldset>
          )}
        </form>
      )}

      {!ended && session.status !== "planned" ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {paused ? null : (
            <button
              type="button"
              disabled={action.isPending || waiting}
              onClick={() => action.mutate("pause")}
              className="min-h-11 rounded-md border border-ink px-4 font-medium disabled:opacity-60"
            >
              Pause
            </button>
          )}
          {confirmFinish ? (
            <>
              <span>Finish now? You cannot add to this conversation afterwards.</span>
              <button
                type="button"
                disabled={complete.isPending || waiting}
                onClick={() => complete.mutate()}
                className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
              >
                Yes, finish
              </button>
              <button type="button" onClick={() => setConfirmFinish(false)} className="min-h-11 rounded-md border border-ink px-4 font-medium">
                Keep going
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={waiting}
              onClick={() => setConfirmFinish(true)}
              className="min-h-11 rounded-md border border-ink px-4 font-medium disabled:opacity-60"
            >
              Finish session
            </button>
          )}
        </div>
      ) : null}

      {controlError ? (
        <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
          {errorText(controlError)}
        </p>
      ) : null}
    </div>
  );
}
