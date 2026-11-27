/**
 * The session spine (SPEC §5.3): warm-up, listen, notice, read, guided
 * practice, conversation, write, summary — one step at a time, in order,
 * all on the session's topic and aimed at its task.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { SessionStateResponse } from "../../shared/debrief";
import { SPINE, grammarMarkers, type LessonMaterials, type PlanGrammar, type SpineStep } from "../../shared/lesson";
import type { ListeningExercise as Exercise } from "../../shared/listening";
import type { SessionPlan } from "../../shared/session";
import { listeningSpeakingShare } from "../../shared/session";
import { useAnswerPractice, useAnswerReading, useAnswerWriting, useCreateMaterials, useDueReviews, useRevealReading } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { CardView } from "../pages/ReviewPage";
import { Section } from "./Section";
import { TaskCheckPanel } from "./TaskCheck";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

const UNVERIFIED = "From a second-hand transcription of the syllabus, not checked against the official document.";

// --- Highlighting -------------------------------------------------------------------

/** Wraps the session's words and grammar pattern parts in <mark>. */
export function Highlighted({ text, words, grammar }: { text: string; words: readonly string[]; grammar: readonly PlanGrammar[] }) {
  const needles = [...words, ...grammar.flatMap((g) => grammarMarkers(g.name).flat())].filter((n) => n.length > 0);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      for (let i = at; i < at + needle.length; i++) marks[i] = true;
      from = at + needle.length;
    }
  }
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const on = marks[i];
    let j = i;
    while (j < text.length && marks[j] === on) j++;
    const chunk = text.slice(i, j);
    parts.push(on ? <mark key={i} className="rounded bg-wash px-0.5 text-cobalt-deep underline decoration-cobalt decoration-2 underline-offset-4">{chunk}</mark> : chunk);
    i = j;
  }
  return <span lang="zh-Hans">{parts}</span>;
}

function targetWords(plan: SessionPlan): string[] {
  return plan.targets.filter((t) => t.role !== "stretch").map((t) => t.hanzi);
}

// --- Steps ------------------------------------------------------------------------------

function Warmup({ onNext }: { onNext: () => void }) {
  const due = useDueReviews();
  const [done, setDone] = useState<string[]>([]);
  const cards = (due.data?.cards ?? []).filter((c) => !done.includes(c.id)).slice(0, Math.max(0, 4 - done.length));
  const card = cards[0];
  if (due.isPending) return <p className="text-mist">Loading your due cards…</p>;
  if (!card) {
    return (
      <div>
        <p>{done.length > 0 ? `Warm-up done: ${done.length} card${done.length === 1 ? "" : "s"} recalled.` : "Nothing is due, so there is nothing to warm up with today."}</p>
        <button type="button" onClick={onNext} className="mt-3 min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze">
          Go to Listen first
        </button>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-mist">Recall before anything new: up to four due cards.</p>
      <CardView key={card.id} card={card} onDone={() => setDone((d) => [...d, card.id])} onSkip={() => setDone((d) => [...d, card.id])} />
    </div>
  );
}

function Notice({ plan, listening }: { plan: SessionPlan; listening: Exercise | null }) {
  const words = targetWords(plan);
  const heard = listening !== null && (listening.answeredAt !== null || listening.revealedAt !== null);
  return (
    <div className="space-y-6">
      {plan.grammar.length > 0 ? (
        <div>
          <h3 className="font-semibold">Grammar</h3>
          <ul className="mt-2 space-y-3">
            {plan.grammar.map((g) => (
              <li key={g.itemId} className="border-l-4 border-cobalt pl-3">
                <Link to={`/curriculum/item/${encodeURIComponent(g.itemId)}`} lang="zh-Hans" className="text-xl font-semibold text-cobalt underline">
                  {g.name}
                </Link>
                <span lang="zh-Hans" className="ml-2 text-sm text-mist">
                  {g.grammarType} · {g.role === "new" ? "new" : "coming back"}
                </span>
                {g.example ? (
                  <p className="mt-1 text-lg">
                    <Highlighted text={g.example} words={[]} grammar={[g]} />
                  </p>
                ) : null}
                {g.unverified ? <p className="mt-1 text-sm text-mist">{UNVERIFIED}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="font-semibold">What you heard</h3>
        {heard && listening ? (
          <ul className="mt-2 space-y-1">
            {listening.lines.map((line, i) => (
              <li key={i} className="text-lg">
                <span className="mr-2 text-sm text-mist">{line.speaker}</span>
                <Highlighted text={line.zh} words={words} grammar={plan.grammar} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-mist">Answer the listening questions first; then the transcript appears here with today's words and patterns marked.</p>
        )}
        {listening && !listening.coversTargets ? (
          <p className="mt-2 text-sm text-mist">This exchange did not use every grammar pattern or enough of today's words; the reading and practice make up for it.</p>
        ) : null}
      </div>

      {plan.characters.length > 0 ? (
        <div>
          <h3 className="font-semibold">Characters</h3>
          <ul className="mt-2 flex flex-wrap gap-3">
            {plan.characters.map((c) => (
              <li key={c.itemId}>
                <Link to={`/curriculum/item/${encodeURIComponent(c.itemId)}`} className="block min-h-11 rounded-md border border-line px-3 py-2 hover:bg-wash">
                  <span lang="zh-Hans" className="font-kai text-3xl">
                    {c.hanzi}
                  </span>
                  <span className="ml-2 text-sm text-mist">
                    in <span lang="zh-Hans">{c.word}</span> · {c.skill === "writing" ? "to write" : "to recognise"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Choices({
  questions,
  answers,
  disabled,
  onSubmit,
}: {
  questions: LessonMaterials["reading"]["questions"];
  answers: number[] | null;
  disabled: boolean;
  onSubmit: (answers: number[]) => void;
}) {
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map((_, i) => answers?.[i] ?? null));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (picked.every((p) => p !== null)) onSubmit(picked as number[]);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {questions.map((q, qi) => (
        <fieldset key={qi}>
          <legend className="font-medium">{q.questionEn}</legend>
          {q.optionsEn.map((option, oi) => {
            const right = q.answerIndex !== null && q.answerIndex === oi;
            return (
              <label key={oi} className="mt-1 flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`reading-${qi}`}
                  checked={picked[qi] === oi}
                  disabled={disabled || answers !== null}
                  onChange={() => setPicked((p) => p.map((v, i) => (i === qi ? oi : v)))}
                />
                <span>
                  {option}
                  {answers !== null && right ? " ✓ right answer" : ""}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
      {answers === null ? (
        <button type="submit" disabled={disabled || picked.some((p) => p === null)} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
          Check answers
        </button>
      ) : null}
    </form>
  );
}

function MaterialsGate({ sessionId, materials, ended, children }: { sessionId: string; materials: LessonMaterials | null; ended: boolean; children: (m: LessonMaterials) => ReactNode }) {
  const create = useCreateMaterials(sessionId);
  if (materials) return <>{children(materials)}</>;
  if (ended) return <p className="text-mist">This session ended before its reading and practice were written.</p>;
  return (
    <div>
      <p className="mb-3">The reading, practice prompts and writing task are written for today's words, grammar and task when you start them.</p>
      <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
        {create.isPending ? "Writing…" : "Start"}
      </button>
      {create.isError ? (
        <p role="alert" className="mt-3 text-seal">
          {errorText(create.error)}
        </p>
      ) : null}
    </div>
  );
}

function Reading({ sessionId, plan, materials }: { sessionId: string; plan: SessionPlan; materials: LessonMaterials }) {
  const answer = useAnswerReading(sessionId);
  const reveal = useRevealReading(sessionId);
  const r = materials.reading;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {r.lines.map((line, i) => (
          <p key={i} className="text-xl leading-relaxed">
            <Highlighted text={line.zh} words={targetWords(plan)} grammar={plan.grammar} />
            {r.revealed ? (
              <span className="mt-1 block text-base text-mist">
                {line.pinyin ? `${line.pinyin} — ` : ""}
                {line.en}
              </span>
            ) : null}
          </p>
        ))}
      </div>
      {r.questions.length > 0 ? (
        <Choices questions={r.questions} answers={r.answers} disabled={answer.isPending} onSubmit={(a) => answer.mutate(a)} />
      ) : null}
      {r.correct !== null ? (
        <p role="status">
          {r.correct} of {r.questions.length} right{r.unassisted ? ", before the translation." : ", after seeing the translation."}
        </p>
      ) : null}
      {!r.revealed ? (
        <button type="button" onClick={() => reveal.mutate()} className="min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt">
          Show pinyin and translation
        </button>
      ) : null}
      {answer.isError ? <p role="alert" className="text-seal">{errorText(answer.error)}</p> : null}
    </div>
  );
}

function ChecksList({ checks }: { checks: { id: string; label: string; met: boolean }[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {checks.map((c) => (
        <li key={c.id}>
          <span aria-hidden="true">{c.met ? "✓" : "✗"}</span> {c.label}: {c.met ? "yes" : "not yet"}
        </li>
      ))}
    </ul>
  );
}

function PracticePrompt({ sessionId, index, prompt, ended }: { sessionId: string; index: number; prompt: LessonMaterials["practice"][number]; ended: boolean }) {
  const send = useAnswerPractice(sessionId);
  const [text, setText] = useState(prompt.result?.answer ?? "");
  const id = `practice-${index}`;
  return (
    <li className="border-b border-line pb-4">
      <p lang="zh-Hans" className="text-lg">
        {prompt.promptZh}
      </p>
      <p className="text-sm text-mist">{prompt.promptEn}</p>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate({ index, answer: text.trim(), mode: "typed" });
        }}
      >
        <label htmlFor={id} className="sr-only">
          Your answer to prompt {index + 1}
        </label>
        <input
          id={id}
          lang="zh-Hans"
          value={text}
          disabled={ended}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-mist bg-glaze px-3"
        />
        <button type="submit" disabled={ended || send.isPending || !text.trim()} className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60">
          Check
        </button>
      </form>
      {prompt.result ? (
        <div role="status" className="mt-2">
          <p className="font-medium">{prompt.result.passed ? "Good: it uses the pattern." : "Not yet. Try again with the pattern."}</p>
          <ChecksList checks={prompt.result.checks} />
          {prompt.modelAnswerZh ? (
            <p className="mt-1 text-mist">
              One way to say it: <span lang="zh-Hans">{prompt.modelAnswerZh}</span>
            </p>
          ) : null}
          <p className="mt-1 text-sm text-mist">Typed answers count as writing practice, not speaking.</p>
        </div>
      ) : null}
      {send.isError ? <p role="alert" className="text-seal">{errorText(send.error)}</p> : null}
    </li>
  );
}

function Writing({ sessionId, plan, materials, ended }: { sessionId: string; plan: SessionPlan; materials: LessonMaterials; ended: boolean }) {
  const send = useAnswerWriting(sessionId);
  const w = materials.writing;
  const [text, setText] = useState(w.result?.answer ?? "");
  return (
    <div className="space-y-3">
      <p lang="zh-Hans" className="text-lg">
        {w.promptZh}
      </p>
      <p className="text-mist">{w.promptEn}</p>
      {plan.task ? (
        <p className="text-sm text-mist">
          Today's task: <span lang="zh-Hans">{plan.task.canDo}</span>
        </p>
      ) : null}
      <p className="font-medium">It should meet these:</p>
      <ul className="list-disc pl-6">
        {w.criteria.map((c) => (
          <li key={c.id}>{c.label}</li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate(text.trim());
        }}
      >
        <label htmlFor="writing-answer" className="mb-1 block font-medium">
          Your writing
        </label>
        <textarea
          id="writing-answer"
          lang="zh-Hans"
          rows={4}
          value={text}
          disabled={ended}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-md border border-mist bg-glaze p-3 text-lg"
        />
        <button type="submit" disabled={ended || send.isPending || !text.trim()} className="mt-2 min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
          Check my writing
        </button>
      </form>
      {w.result ? (
        <div role="status">
          <p className="font-medium">{w.result.passed ? "All criteria met." : "Some criteria are not met yet. You can revise and check again."}</p>
          <ChecksList checks={w.result.checks} />
        </div>
      ) : null}
      {send.isError ? <p role="alert" className="text-seal">{errorText(send.error)}</p> : null}
    </div>
  );
}

/** What the session's targets met so far: a record of use, not knowledge. */
export function TargetsMet({ state }: { state: SessionStateResponse }) {
  const { session, turns, materials } = state;
  const { plan } = session;
  if (plan.grammar.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold">Grammar today</h3>
      <ul className="mt-2 space-y-1">
        {plan.grammar.map((g) => {
          const said = turns.some((t) => t.learnerGrammarIds.includes(g.itemId));
          const practised = materials?.practice.some((p) => p.grammarId === g.itemId && p.result?.passed) ?? false;
          const wrote = materials?.writing.result?.checks.some((c) => c.id === `grammar:${g.itemId}` && c.met) ?? false;
          const where = [said && "in conversation", practised && "in guided practice", wrote && "in writing"].filter(Boolean);
          return (
            <li key={g.itemId}>
              <span lang="zh-Hans" className="font-medium">
                {g.name}
              </span>
              : {where.length > 0 ? `you used it ${where.join(", ")}.` : "you have not used it yet."}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- The spine ------------------------------------------------------------------------------

function isStep(value: string | null): value is SpineStep {
  return value !== null && (SPINE as readonly string[]).includes(value);
}

export interface SpineProps {
  state: SessionStateResponse;
  /** The listen and conversation steps, already built by the page. */
  listen: ReactNode;
  conversation: ReactNode;
  summary: ReactNode;
}

function stepDone(step: SpineStep, state: SessionStateResponse): boolean {
  const { listening, materials, turns, debrief } = state;
  switch (step) {
    case "listen":
      return listening?.answeredAt != null;
    case "notice":
      return false;
    case "read":
      return materials?.reading.correct != null;
    case "practice":
      return (materials?.practice.length ?? 0) > 0 && (materials?.practice.every((p) => p.result !== null) ?? false);
    case "speak":
      return turns.length > 0;
    case "write":
      return materials?.writing.result != null;
    case "summary":
      return debrief !== null;
    default:
      return false;
  }
}

export function SessionSpine({ state, listen, conversation, summary }: SpineProps) {
  const { session, materials } = state;
  const { plan } = session;
  const ended = session.status === "complete" || session.status === "abandoned";
  const [params, setParams] = useSearchParams();
  const raw = params.get("step");
  const step: SpineStep = isStep(raw) ? raw : ended ? "summary" : "warmup";
  const go = (next: SpineStep) => {
    const p = new URLSearchParams(params);
    p.set("step", next);
    setParams(p, { replace: false });
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        // jsdom and old browsers.
      }
    }
  };
  // Finishing from the conversation moves on to the summary.
  const wasEnded = useRef(ended);
  useEffect(() => {
    if (ended && !wasEnded.current && step !== "summary") go("summary");
    wasEnded.current = ended;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);
  const index = SPINE.indexOf(step);
  const activity = plan.activities.find((a) => a.kind === step);
  const oral = Math.round(listeningSpeakingShare(plan.activities) * 100);
  const next = SPINE[index + 1];
  const prev = SPINE[index - 1];

  const body: Record<SpineStep, ReactNode> = {
    warmup: <Warmup onNext={() => go("listen")} />,
    listen,
    notice: <Notice plan={plan} listening={state.listening} />,
    read: (
      <MaterialsGate sessionId={session.id} materials={materials} ended={ended}>
        {(m) => <Reading sessionId={session.id} plan={plan} materials={m} />}
      </MaterialsGate>
    ),
    practice: (
      <MaterialsGate sessionId={session.id} materials={materials} ended={ended}>
        {(m) => (
          <ol className="space-y-4">
            {m.practice.map((p, i) => (
              <PracticePrompt key={i} sessionId={session.id} index={i} prompt={p} ended={ended} />
            ))}
          </ol>
        )}
      </MaterialsGate>
    ),
    speak: conversation,
    write: (
      <MaterialsGate sessionId={session.id} materials={materials} ended={ended}>
        {(m) => <Writing sessionId={session.id} plan={plan} materials={m} ended={ended} />}
      </MaterialsGate>
    ),
    summary: (
      <div className="space-y-4">
        <TargetsMet state={state} />
        <TaskCheckPanel session={session} />
        {summary}
        {ended && state.turns.length > 0 ? conversation : null}
      </div>
    ),
  };

  return (
    <div>
      <nav aria-label="Session steps" className="mb-4">
        <ol className="flex flex-wrap gap-2">
          {plan.activities.map((a, i) => {
            const k = a.kind as SpineStep;
            if (!isStep(k)) return null;
            const current = k === step;
            const done = stepDone(k, state);
            return (
              <li key={k}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => go(k)}
                  className={`min-h-11 rounded-md border px-3 text-sm font-medium ${current ? "border-cobalt bg-cobalt text-glaze" : "border-line text-cobalt hover:bg-wash"}`}
                >
                  {i + 1}. {a.title}
                  {a.minutes > 0 ? ` · ${a.minutes} min` : ""}
                  {done ? <span className="sr-only"> (done)</span> : null}
                  {done ? <span aria-hidden="true"> ✓</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-sm text-mist">
          {oral}% of the time is listening and speaking. Times are a guide, not a cut-off.
          {plan.weakestSkill ? ` Extra time today for ${plan.weakestSkill}, your weakest skill over the last two weeks.` : ""}
        </p>
      </nav>

      <Section title={activity ? activity.title : "Step"}>
        {activity ? <p className="mb-4 text-mist">{activity.description}</p> : null}
        {body[step]}
      </Section>

      <div className="flex flex-wrap justify-between gap-3">
        {prev ? (
          <button type="button" onClick={() => go(prev)} className="min-h-11 rounded-md border border-ink px-4 font-medium">
            Back
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button type="button" onClick={() => go(next)} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze">
            Next: {plan.activities.find((a) => a.kind === next)?.title ?? next}
          </button>
        ) : null}
      </div>
    </div>
  );
}
