import { useState, type FormEvent } from "react";
import type { ProviderStatus } from "../../shared/api";
import { SLOWER_RATE_FACTOR, type ListeningExercise as Exercise } from "../../shared/listening";
import type { SessionDetail } from "../../shared/session";
import { useAnswerListening, useCreateListening, useListeningEvent } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { problemText } from "../speech/problems";
import { useVoice } from "../speech/useVoice";

const PLAYING_KEY = "listening";
const LETTERS = ["A", "B", "C", "D"];

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

interface ListeningExerciseProps {
  session: SessionDetail;
  exercise: Exercise | null;
  speechRate: number;
  speech: ProviderStatus | null;
}

/**
 * The listen-first exercise (SPEC §5.3 step 2): hear a short exchange, answer
 * questions about it, and only then see the text. Answers given after the
 * text was shown are kept but not counted as listening (SPEC §6.5, §10).
 */
export function ListeningExercise({ session, exercise, speechRate, speech }: ListeningExerciseProps) {
  const create = useCreateListening(session.id);
  const ended = session.status === "complete" || session.status === "abandoned";
  const paused = session.status === "paused";

  if (exercise) return <ExerciseView session={session} exercise={exercise} speechRate={speechRate} speech={speech} />;
  if (ended) return null;

  return (
    <div>
      <p className="max-w-[60ch]">
        Hear a short exchange about the situation, with no text. Then answer two or three questions
        about it before the text is shown. Answers given before seeing the text are your listening
        score.
      </p>
      {paused ? <p className="mt-3 text-mist">Resume the session to start listening.</p> : null}
      <button
        type="button"
        disabled={paused || create.isPending}
        onClick={() => create.mutate()}
        className="mt-3 min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
      >
        {create.isPending ? "Writing the exchange…" : "Start listening"}
      </button>
      {create.isError ? (
        <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
          {errorText(create.error)}
        </p>
      ) : null}
    </div>
  );
}

function ExerciseView({ session, exercise, speechRate, speech }: ListeningExerciseProps & { exercise: Exercise }) {
  const voice = useVoice(session.id, speechRate);
  const event = useListeningEvent(session.id);
  const answer = useAnswerListening(session.id);
  const [choices, setChoices] = useState<(number | null)[]>(() => exercise.questions.map(() => null));

  const speechOff = speech === null || speech.mode === "missing";
  const { phase, problem, speakingTurnId, deviceVoiceOffer, allowance } = voice.state;
  const playing = speakingTurnId === PLAYING_KEY && (phase === "starting" || phase === "speaking");
  const canPlay = !speechOff && (allowance?.synthesisAvailable ?? true);
  const answered = exercise.answers !== null;
  const revealed = exercise.revealedAt !== null;
  const text = exercise.lines.map((l) => l.zh).join("\n");

  const markPlayed = () => {
    if (exercise.playedAt === null) event.mutate("played");
  };
  const play = (slower: boolean) =>
    void voice.speakText(PLAYING_KEY, text, { rate: slower ? speechRate * SLOWER_RATE_FACTOR : speechRate, onPlayed: markPlayed });
  const reveal = () => {
    voice.stop();
    event.mutate("revealed");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (choices.some((c) => c === null)) return;
    answer.mutate(choices as number[]);
  };

  return (
    <div>
      {exercise.standIn ? (
        <p className="mb-4 border-l-4 border-line bg-wash px-4 py-3">
          <span className="font-semibold">Practice stand-in exchange.</span> Written by the local
          stand-in, not a language model. It is for trying the app only.
        </p>
      ) : null}
      {exercise.source === "prepared" ? (
        <p className="mb-4 border-l-4 border-line bg-wash px-4 py-3">
          <span className="font-semibold">Prepared exchange.</span> The tutor's own exchange could
          not be used, so one written for ShuoLab is shown instead. It is not about today's
          situation.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {playing ? (
          <button type="button" onClick={voice.stop} className="min-h-11 rounded-md border border-ink px-4 font-medium">
            Stop
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={!canPlay}
              onClick={() => play(false)}
              className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
            >
              Play the exchange
            </button>
            <button
              type="button"
              disabled={!canPlay}
              onClick={() => play(true)}
              className="min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt disabled:opacity-60"
            >
              Play slower
            </button>
          </>
        )}
        {deviceVoiceOffer === PLAYING_KEY ? (
          <button
            type="button"
            onClick={() => void voice.speakTextOnDevice(PLAYING_KEY, text, { onPlayed: markPlayed })}
            className="min-h-11 rounded-md border border-ink px-4 font-medium"
          >
            Use the device voice (quality varies)
          </button>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-2 text-sm text-mist">
        {playing ? "Playing…" : exercise.playedAt ? "Heard at least once. Play it again as often as you like." : null}
      </p>
      {speechOff ? (
        <p className="mt-2 text-mist">
          Speech is not set up, so the exchange can't be played. You can show the text and read it,
          but that is reading practice and gives no listening score.
        </p>
      ) : speech?.mode === "mock" ? (
        <p className="mt-2 text-mist">Practice stand-in speech: Play makes no sound.</p>
      ) : null}
      {problem ? (
        <div role="alert" className="mt-2 border-l-4 border-seal bg-seal-wash px-4 py-3">
          <p>{problemText(problem)}</p>
          <button type="button" onClick={voice.clearProblem} className="mt-2 min-h-11 font-medium text-cobalt underline">
            Dismiss
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-5">
        {exercise.questions.map((question, qi) => {
          const chosen = answered ? (exercise.answers?.[qi] ?? null) : choices[qi];
          const right = question.answerIndex;
          return (
            <fieldset key={qi} disabled={answered || answer.isPending}>
              <legend className="font-medium">
                {qi + 1}. {question.questionEn}
              </legend>
              <div className="mt-2 space-y-1">
                {question.optionsEn.map((option, oi) => (
                  <label key={oi} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name={`listening-q${qi}`}
                      checked={chosen === oi}
                      onChange={() => setChoices((c) => c.map((v, i) => (i === qi ? oi : v)))}
                      className="size-5"
                    />
                    <span>
                      {LETTERS[oi]}. {option}
                      {answered && right === oi ? <span className="ml-2 font-semibold text-cobalt-deep">Correct answer</span> : null}
                      {answered && chosen === oi && right !== oi ? <span className="ml-2 font-semibold text-seal">Your answer</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        {!answered ? (
          <button
            type="submit"
            disabled={choices.some((c) => c === null) || answer.isPending}
            className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
          >
            Check answers
          </button>
        ) : null}
      </form>
      {answer.isError ? (
        <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
          {errorText(answer.error)}
        </p>
      ) : null}

      {exercise.result ? (
        <p aria-live="polite" className="mt-4 border-l-4 border-cobalt bg-wash px-4 py-3">
          <span className="font-semibold">
            {exercise.result.correct} of {exercise.result.total} correct
          </span>
          {exercise.result.unassisted
            ? ", answered before seeing the text. This counts as a listening check."
            : ", answered after the text was shown, so it is not counted as listening."}
        </p>
      ) : null}

      <div className="mt-6">
        {revealed ? (
          <Transcript exercise={exercise} />
        ) : (
          <>
            <button type="button" onClick={reveal} className="min-h-11 font-medium text-cobalt underline">
              {answered ? "Show the text" : "Skip the questions and show the text"}
            </button>
            {!answered ? (
              <p className="text-sm text-mist">Answers given after seeing the text are not counted as listening.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Transcript({ exercise }: { exercise: Exercise }) {
  return (
    <ol aria-label="The exchange" className="space-y-3 border-t border-line pt-3">
      {exercise.lines.map((line, i) => (
        <li key={i} className="flex gap-3">
          <span className="w-6 shrink-0 font-semibold text-mist">{line.speaker}</span>
          <span className="min-w-0">
            <span lang="zh-Hans" className="block text-xl">
              {line.zh}
            </span>
            <span className="block text-mist">{line.pinyin}</span>
            <span className="block">{line.en}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
