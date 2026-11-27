/**
 * The sound-system on-ramp (SPEC §5.9, FR-032): pinyin, tones, tone changes
 * and typing, before HSK sessions. Authored for ShuoLab; not HSK content.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ALL_UNITS, CHECK_VOICE, DRILL_VOICES, TONE_CHECK, UNITS, passMark, type OnrampResult, type Unit } from "../../shared/onramp";
import { defaultSettings } from "../../shared/settings";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useAnswerUnit, useMe, useOnramp } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { problemText } from "../speech/problems";
import { useVoice } from "../speech/useVoice";
import { NotFoundPage } from "./NotFoundPage";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

export function StartPage() {
  const status = useOnramp();
  const best = (id: string) => status.data?.units.find((u) => u.unitId === id);
  return (
    <>
      <PageHeader
        zh="从零开始"
        en="Start here: the sounds of Mandarin"
        summary="Pinyin, the four tones, tone changes and typing Chinese, before your first lessons. Written for ShuoLab; not HSK content."
      />
      <AsyncStatus isPending={status.isPending} error={status.error} onRetry={() => void status.refetch()} label="your progress">
        {status.data?.checkPassed ? (
          <p className="mb-4 border-l-4 border-cobalt bg-wash px-4 py-3">
            Tone check passed. You are ready for daily sessions; come back to any unit when you want.
          </p>
        ) : null}
        <ol className="border-t border-line">
          {[...UNITS, TONE_CHECK].map((unit, i) => {
            const b = best(unit.id);
            const done = b ? b.bestCorrect / b.total >= passMark(unit.id) : false;
            return (
              <li key={unit.id} className="border-b border-line">
                <Link to={`/start/${unit.id}`} className="flex min-h-14 flex-wrap items-baseline gap-x-4 py-3 hover:bg-wash">
                  <span className="w-6 text-mist tabular-nums">{i + 1}</span>
                  <span lang="zh-Hans" className="text-lg">
                    {unit.titleZh}
                  </span>
                  <span>{unit.title}</span>
                  <span className="ml-auto text-sm text-mist">
                    {b ? `Best ${b.bestCorrect} of ${b.total}${done ? " ✓" : ""}` : "Not tried"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </AsyncStatus>
    </>
  );
}

function Drill({ unit }: { unit: Unit }) {
  const me = useMe();
  const { speechRate } = me.data?.settings ?? defaultSettings();
  const speech = me.data?.providers.find((p) => p.id === "speech") ?? null;
  const speechOff = speech === null || speech.mode === "missing";
  const voice = useVoice(null, speechRate);
  const send = useAnswerUnit();
  const [answers, setAnswers] = useState<(number | string | null)[]>(() => unit.items.map(() => null));
  const [result, setResult] = useState<OnrampResult | null>(null);
  const isCheck = unit.id === TONE_CHECK.id;
  const play = (i: number) => {
    const item = unit.items[i];
    if (!item) return;
    // Voices alternate in the units; the check uses one they never do.
    const v = isCheck ? CHECK_VOICE : DRILL_VOICES[i % DRILL_VOICES.length];
    void voice.speakText(`onramp-${unit.id}-${i}`, item.text, { voice: v, phoneme: item.phoneme, rate: Math.min(speechRate, 0.9) });
  };
  const set = (i: number, v: number | string) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate({ unitId: unit.id, answers }, { onSuccess: ({ result: r }) => setResult(r) });
      }}
      className="space-y-4"
    >
      {unit.mode === "listen" && speechOff ? (
        <p className="border-l-4 border-seal bg-seal-wash px-4 py-3">Speech is not set up, so these sounds can't be played. Set up Azure Speech in Settings first.</p>
      ) : unit.mode === "listen" && speech?.mode === "mock" ? (
        <p className="text-mist">Practice stand-in speech: Play makes no sound.</p>
      ) : null}
      <ol className="space-y-4">
        {unit.items.map((item, i) => {
          const mark = result?.marks[i];
          return (
            <li key={i} className="border-b border-line pb-3">
              <fieldset>
                <legend className="font-medium">
                  {i + 1}. {item.ask ?? unit.ask}
                </legend>
                {unit.mode === "listen" ? (
                  <button type="button" onClick={() => play(i)} disabled={speechOff} className="mt-2 min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60">
                    Play
                  </button>
                ) : unit.mode === "read" ? (
                  <p lang="zh-Hans" className="mt-1 text-xl">
                    {item.text}
                  </p>
                ) : null}
                {unit.mode === "type" ? (
                  <div className="mt-2">
                    <p className="text-lg">{item.ask}</p>
                    <label htmlFor={`onramp-${i}`} className="sr-only">
                      Type item {i + 1}
                    </label>
                    <input
                      id={`onramp-${i}`}
                      lang="zh-Hans"
                      value={typeof answers[i] === "string" ? (answers[i] as string) : ""}
                      disabled={result !== null}
                      onChange={(e) => set(i, e.target.value)}
                      className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3 text-xl"
                    />
                  </div>
                ) : (
                  <div className="mt-2">
                    {item.options.map((o, k) => (
                      <label key={k} className="flex min-h-11 items-center gap-2">
                        <input type="radio" name={`onramp-${i}`} checked={answers[i] === k} disabled={result !== null} onChange={() => set(i, k)} />
                        <span>{o}</span>
                      </label>
                    ))}
                  </div>
                )}
                {result ? (
                  <p className="mt-1 font-medium">
                    {mark ? "✓ Right." : "✗"} {mark ? "" : <span lang="zh-Hans">Answer: {result.keys[i]}</span>}
                    {unit.mode === "listen" ? <span lang="zh-Hans" className="ml-2 text-mist">({item.text})</span> : null}
                  </p>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {voice.state.problem ? (
        <p role="alert" className="text-seal">
          {problemText(voice.state.problem)}
        </p>
      ) : null}
      {result ? (
        <div role="status" className="border-l-4 border-cobalt bg-wash px-4 py-3">
          <p className="font-semibold">
            {result.correct} of {result.total} right. {result.passed ? (isCheck ? "Tone check passed." : "Unit passed.") : `${Math.round(passMark(unit.id) * 100)}% passes; try again whenever you like.`}
          </p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setAnswers(unit.items.map(() => null));
            }}
            className="mt-2 min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt"
          >
            Try again
          </button>
        </div>
      ) : (
        <button type="submit" disabled={send.isPending} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
          Check my answers
        </button>
      )}
      {send.isError ? (
        <p role="alert" className="text-seal">
          {errorText(send.error)}
        </p>
      ) : null}
    </form>
  );
}

export function StartUnitPage() {
  const { unitId = "" } = useParams();
  const unit = ALL_UNITS.find((u) => u.id === unitId);
  if (!unit) return <NotFoundPage />;
  const index = ALL_UNITS.indexOf(unit);
  const next = ALL_UNITS[index + 1];
  return (
    <>
      <p className="mb-2">
        <Link to="/start" className="font-medium text-cobalt underline">
          All units
        </Link>
      </p>
      <PageHeader zh={unit.titleZh} en={unit.title} />
      <Section title="How it works">
        {unit.explain.map((p) => (
          <p key={p} className="mb-2 max-w-[65ch]">
            {p}
          </p>
        ))}
      </Section>
      <Section title={unit.id === TONE_CHECK.id ? "Check" : "Practice"}>
        <Drill key={unit.id} unit={unit} />
      </Section>
      {next ? (
        <p className="mt-6">
          <Link to={`/start/${next.id}`} className="font-medium text-cobalt underline">
            Next: {next.title}
          </Link>
        </p>
      ) : null}
    </>
  );
}
