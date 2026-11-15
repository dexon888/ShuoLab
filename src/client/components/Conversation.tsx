import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { ProviderStatus } from "../../shared/api";
import type { SessionDetail } from "../../shared/session";
import type { DisplayMode } from "../../shared/settings";
import { MAX_TRANSCRIPT_CHARS, type Turn } from "../../shared/tutor";
import { useCompleteSession, useSendTurn, useSession, useSessionAction } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { loadDraft, saveDraft, type SessionDraft } from "../lib/draft";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

/** The tutor's side of one turn: characters first, help only as the settings or the learner ask. */
function TutorReply({ turn, displayMode, words }: { turn: Turn; displayMode: DisplayMode; words: ReadonlyMap<string, string> }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const showEnglish = chosen ?? displayMode === "hanzi_pinyin_english";
  const { reply } = turn;
  const used = turn.referencedCurriculumItemIds.map((id) => words.get(id)).filter((w): w is string => w !== undefined);

  return (
    <div className="mt-3 border-l-4 border-cobalt bg-wash px-4 py-3">
      <p className="text-sm font-semibold text-cobalt-deep">Tutor</p>
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
      {turn.fallback ? (
        <p className="mt-2 text-sm text-mist">
          Prepared reply. The tutor's own answer could not be used, so no feedback was recorded for this turn.
        </p>
      ) : null}
      {used.length > 0 ? (
        <p className="mt-2 text-sm text-mist">
          From today's words: <span lang="zh-Hans">{used.join("、")}</span>
        </p>
      ) : null}
    </div>
  );
}

function TurnList({ turns, displayMode, words }: { turns: readonly Turn[]; displayMode: DisplayMode; words: ReadonlyMap<string, string> }) {
  return (
    <ol aria-label="Conversation so far" className="space-y-6">
      {turns.map((turn) => (
        <li key={turn.turnId}>
          <div className="px-4">
            <p className="text-sm font-semibold text-mist">
              You <span className="font-normal">({turn.sourceMode === "typed" ? "typed" : "spoken"})</span>
            </p>
            <p lang="zh-Hans" className="mt-1 text-xl leading-relaxed break-words whitespace-pre-wrap">
              {turn.learnerText}
            </p>
          </div>
          <TutorReply turn={turn} displayMode={displayMode} words={words} />
        </li>
      ))}
    </ol>
  );
}

interface ConversationProps {
  session: SessionDetail;
  turns: readonly Turn[];
  displayMode: DisplayMode;
  tutor: ProviderStatus | null;
}

/** The typed conversation for one session: saved turns, the message box, and pause and finish. */
export function Conversation({ session, turns, displayMode, tutor }: ConversationProps) {
  const sessionId = session.id;
  const send = useSendTurn(sessionId);
  const action = useSessionAction(sessionId);
  const complete = useCompleteSession(sessionId);
  const saved = useSession(sessionId);

  const [draft, setDraftState] = useState<SessionDraft>(() => loadDraft(sessionId));
  const [softLimit, setSoftLimit] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
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

  useEffect(() => {
    // Forget a stored message once the server has it, so a reload does not offer to resend it.
    if (delivered) saveDraft(sessionId, { text: draft.text, pending: null });
  }, [delivered, sessionId, draft.text]);

  useEffect(() => {
    // Not smooth: nothing moves for people who ask for reduced motion.
    endRef.current?.scrollIntoView?.({ block: "nearest" });
    if (refocus.current && !waiting) {
      refocus.current = false;
      boxRef.current?.focus();
    }
  }, [turns.length, waiting]);

  const deliver = (message: { clientTurnId: string; transcript: string }) => {
    send.mutate(message, {
      onSuccess: (result) => {
        setSoftLimit(result.usage.softLimitReached);
        setDraft({ text: "", pending: null });
        refocus.current = true;
      },
    });
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const transcript = draft.text.trim();
    if (!transcript || waiting || pending || paused || ended) return;
    const message = { clientTurnId: crypto.randomUUID(), transcript };
    setDraft({ text: "", pending: message });
    deliver(message);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter makes a new line. Enter that confirms an input-method choice does neither.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  /** Puts an unsent message back in the box, unless the server turns out to have it. */
  const editInstead = async () => {
    if (!pending) return;
    const latest = await saved.refetch();
    const arrived = latest.data?.turns.some((t) => t.clientTurnId === pending.clientTurnId) ?? false;
    send.reset();
    setDraft(arrived ? { text: "", pending: null } : { text: pending.transcript, pending: null });
    boxRef.current?.focus();
  };

  const sendError = send.error;
  const overBudget = sendError instanceof ApiRequestError && sendError.code === "BUDGET_EXCEEDED";
  const canRetry = !(sendError instanceof ApiRequestError) || sendError.retryable || sendError.code === "CONFLICT";
  const controlError = action.error ?? complete.error;
  const remaining = MAX_TRANSCRIPT_CHARS - draft.text.length;

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

      {turns.length === 0 && !ended ? (
        <p className="mb-4 text-mist">
          Start with a sentence or two in Chinese about the situation above. The tutor answers in
          Chinese and asks one question back. Corrections wait for the summary at the end.
        </p>
      ) : null}

      <TurnList turns={turns} displayMode={displayMode} words={words} />

      {pending ? (
        <div className="mt-6 px-4">
          <p className="text-sm font-semibold text-mist">You (typed)</p>
          <p lang="zh-Hans" className="mt-1 text-xl leading-relaxed break-words whitespace-pre-wrap">
            {pending.transcript}
          </p>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="mt-3 min-h-6 px-4 text-mist">
        {waiting ? "The tutor is replying…" : ""}
      </p>

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
            onChange={(event) => setDraft({ text: event.target.value, pending })}
            onKeyDown={onKeyDown}
            aria-describedby={helpId}
            className="mt-1 w-full rounded-md border border-line bg-glaze px-3 py-2 text-xl"
          />
          <p id={helpId} className="mt-1 text-sm text-mist">
            Enter sends. Shift+Enter starts a new line.
            {remaining <= 200 ? ` ${remaining} characters left.` : ""} Typing is writing practice; it is not counted as
            speaking.
          </p>
          <button
            type="submit"
            disabled={waiting || pending !== null || draft.text.trim() === ""}
            className="mt-3 min-h-12 w-full rounded-md bg-cobalt px-5 text-lg font-semibold text-glaze hover:bg-cobalt-deep disabled:opacity-60 sm:w-auto"
          >
            Send
          </button>
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
