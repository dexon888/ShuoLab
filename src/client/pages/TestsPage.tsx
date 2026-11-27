/**
 * Band practice tests and monthly checkpoints (SPEC §6.5, FR-027, FR-022).
 * Personal tracking from imported items: never an HSK score or pass.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Assessment, TestQuestion } from "../../shared/assessment";
import { HSK_BANDS, type HskBand } from "../../shared/curriculum";
import { defaultSettings } from "../../shared/settings";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useAssessment, useAssessments, useFinishAssessment, useMe, useStartAssessment } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { problemText } from "../speech/problems";
import { useVoice } from "../speech/useVoice";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

const SECTION_LABELS: Readonly<Record<TestQuestion["kind"], string>> = {
  word_reading: "Words: reading",
  word_listening: "Words: listening",
  grammar_gap: "Grammar",
  character_word: "Characters",
  writing_task: "Writing",
  speaking_task: "Speaking",
};

const KIND_LABELS = { band_test: "Band practice test", checkpoint: "Monthly checkpoint" } as const;

const NOT_A_SCORE = "Built from your imported items and scored by fixed keys. Personal tracking only: never an HSK score or pass.";

export function TestsPage() {
  const me = useMe();
  const list = useAssessments();
  const startTest = useStartAssessment();
  const navigate = useNavigate();
  const [band, setBand] = useState<HskBand | "">("");
  const chosen: HskBand = band || me.data?.settings.studyBand || "1";
  const start = (kind: "band_test" | "checkpoint") =>
    startTest.mutate({ band: chosen, kind }, { onSuccess: ({ assessment }) => void navigate(`/tests/${assessment.id}`) });

  return (
    <>
      <PageHeader zh="测试" en="Tests" summary={NOT_A_SCORE} />
      <Section title="Start">
        <label className="block max-w-xs">
          <span className="mb-1 block font-medium">Band</span>
          <select value={chosen} onChange={(e) => setBand(e.target.value as HskBand)} className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3">
            {HSK_BANDS.map((b) => (
              <option key={b} value={b}>
                {bandName(b)}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={startTest.isPending} onClick={() => start("band_test")} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
            Start a band practice test
          </button>
          {list.data?.checkpointDue ? (
            <button type="button" disabled={startTest.isPending} onClick={() => start("checkpoint")} className="min-h-11 rounded-md border border-cobalt px-5 font-semibold text-cobalt disabled:opacity-60">
              Take this month's checkpoint
            </button>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-mist">
          A band test asks about words, grammar and characters of the band, then a short writing task set in one of its
          tasks. The monthly checkpoint asks only about words you have not met in a session, and adds a spontaneous
          speaking task, so months can be compared on unseen material.
        </p>
        {startTest.isError ? (
          <p role="alert" className="mt-3 text-seal">
            {errorText(startTest.error)}
          </p>
        ) : null}
      </Section>

      <Section title="Past tests">
        <AsyncStatus isPending={list.isPending} error={list.error} onRetry={() => void list.refetch()} label="your tests">
          {list.data && list.data.runs.length === 0 ? <p className="text-mist">No tests yet.</p> : null}
          <ul className="border-t border-line">
            {(list.data?.runs ?? []).map((run) => (
              <li key={run.id} className="border-b border-line">
                <Link to={`/tests/${run.id}`} className="flex min-h-14 flex-wrap items-baseline gap-x-4 py-3 hover:bg-wash">
                  <span className="font-medium">{KIND_LABELS[run.kind]}</span>
                  <span className="text-mist">
                    {bandName(run.hskBand)} · {run.startedAt.slice(0, 10)}
                  </span>
                  <span className="ml-auto text-sm">{run.results ? `${run.results.correct} of ${run.results.total}` : "Not finished"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </AsyncStatus>
      </Section>
    </>
  );
}

function Question({
  q,
  value,
  onChange,
  onSpoken,
  done,
}: {
  q: TestQuestion;
  value: number | string | null;
  onChange: (v: number | string | null) => void;
  onSpoken: (spoken: boolean) => void;
  done: Assessment["results"];
}) {
  const me = useMe();
  const { speechRate } = me.data?.settings ?? defaultSettings();
  const speech = me.data?.providers.find((p) => p.id === "speech") ?? null;
  const speechOff = speech === null || speech.mode === "missing";
  const voice = useVoice(null, speechRate);
  const result = done?.questions.find((r) => r.index === q.index) ?? null;
  return (
    <fieldset className="border-b border-line pb-4">
      <legend className="font-medium">
        {q.index + 1}. {q.ask}
      </legend>
      {q.prompt ? (
        <p lang="zh-Hans" className={q.kind === "character_word" ? "mt-2 font-kai text-5xl" : "mt-2 text-2xl"}>
          {q.prompt}
        </p>
      ) : null}
      {q.audio ? (
        <button
          type="button"
          disabled={speechOff}
          onClick={() => void voice.speakText(`test-${q.index}`, q.audio ?? "", { rate: speechRate })}
          className="mt-2 min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
        >
          Play
        </button>
      ) : null}
      {q.options.length > 0 ? (
        <div className="mt-2">
          {q.options.map((o, i) => (
            <label key={i} className="flex min-h-11 items-center gap-2">
              <input type="radio" name={`q-${q.index}`} checked={value === i} disabled={done !== null} onChange={() => onChange(i)} />
              <span lang="zh-Hans">{o}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="mt-2">
          <label htmlFor={`q-${q.index}-text`} className="sr-only">
            Your answer to question {q.index + 1}
          </label>
          <textarea
            id={`q-${q.index}-text`}
            lang="zh-Hans"
            rows={3}
            value={typeof value === "string" ? value : ""}
            disabled={done !== null}
            onChange={(e) => {
              onChange(e.target.value);
              onSpoken(false);
            }}
            className="w-full rounded-md border border-mist bg-glaze p-3 text-lg"
          />
          {q.kind === "speaking_task" && done === null ? (
            <button
              type="button"
              disabled={speechOff || !voice.canRecord}
              onClick={async () => {
                const heard = await voice.listen();
                if (heard?.kind === "recognized") {
                  onChange(heard.text);
                  onSpoken(true);
                }
              }}
              className="mt-2 min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
            >
              Speak
            </button>
          ) : null}
          <ul className="mt-1 text-sm text-mist">
            {q.criteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {q.kind === "speaking_task" ? <p className="text-sm text-mist">A typed answer is recorded as writing, not speaking.</p> : null}
        </div>
      )}
      {q.unverifiedKey ? <p className="mt-1 text-sm text-mist">Unverified key: built from a second-hand transcription of the syllabus.</p> : null}
      {voice.state.problem ? (
        <p role="alert" className="mt-2 text-seal">
          {problemText(voice.state.problem)}
        </p>
      ) : null}
      {result ? (
        <p className="mt-2 font-medium">
          {result.correct ? "✓ Right." : "✗ Not this time."} <span lang="zh-Hans">{result.key}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

function Runner({ test }: { test: Assessment }) {
  const finish = useFinishAssessment(test.id);
  const [answers, setAnswers] = useState<(number | string | null)[]>(() => test.questions.map(() => null));
  const [spoken, setSpoken] = useState<boolean[]>(() => test.questions.map(() => false));
  const done = test.results;
  return (
    <>
      <PageHeader zh="测试" en={`${KIND_LABELS[test.kind]}: ${bandName(test.hskBand)}`} summary={NOT_A_SCORE} />
      {test.synthetic ? <p className="mb-4 text-mist">Generated placeholder items for testing, not HSK content.</p> : null}
      {test.frame.task ? (
        <p className="mb-4">
          Set in <span lang="zh-Hans">{test.frame.topic ?? "the band"}</span>; task: <span lang="zh-Hans">{test.frame.task}</span>
        </p>
      ) : null}
      {done ? (
        <Section title="Result">
          <p>
            <span className="font-semibold tabular-nums">{done.correct}</span> of {done.total} on {test.finishedAt?.slice(0, 10)} (
            {test.rubricVersion}).
          </p>
          <ul className="mt-2 space-y-1">
            {done.sections.map((s) => (
              <li key={s.kind}>
                {SECTION_LABELS[s.kind]}: {s.correct} of {s.total}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-mist">Each answer counts as recall evidence for the item it asked about. {NOT_A_SCORE}</p>
        </Section>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          finish.mutate({ answers, spoken });
        }}
        className="space-y-4"
      >
        {test.questions.map((q) => (
          <Question
            key={q.index}
            q={q}
            value={answers[q.index] ?? null}
            done={done}
            onChange={(v) => setAnswers((a) => a.map((x, i) => (i === q.index ? v : x)))}
            onSpoken={(s) => setSpoken((a) => a.map((x, i) => (i === q.index ? s : x)))}
          />
        ))}
        {done ? null : (
          <button type="submit" disabled={finish.isPending} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
            Finish and score
          </button>
        )}
        {finish.isError ? (
          <p role="alert" className="text-seal">
            {errorText(finish.error)}
          </p>
        ) : null}
      </form>
      <p className="mt-6">
        <Link to="/tests" className="font-medium text-cobalt underline">
          All tests
        </Link>
      </p>
    </>
  );
}

export function TestPage() {
  const { testId = "" } = useParams();
  const test = useAssessment(testId);
  return (
    <AsyncStatus isPending={test.isPending} error={test.error} onRetry={() => void test.refetch()} label="this test">
      {test.data ? <Runner key={test.data.assessment.id + (test.data.assessment.finishedAt ?? "")} test={test.data.assessment} /> : null}
    </AsyncStatus>
  );
}
