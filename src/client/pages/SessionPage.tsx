import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { SessionStateResponse } from "../../shared/debrief";
import { TARGET_ROLE_LABELS, type SessionDetail, type SessionPlan } from "../../shared/session";
import { defaultSettings } from "../../shared/settings";
import { AsyncStatus } from "../components/AsyncStatus";
import { Conversation } from "../components/Conversation";
import { ListeningExercise } from "../components/ListeningExercise";
import { Section } from "../components/Section";
import { SessionDebrief } from "../components/SessionDebrief";
import { SessionSpine } from "../components/SessionSpine";
import { SyntheticDataNotice } from "../components/SyntheticDataNotice";
import { useDeleteSession, useMe, useSession } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { NotFoundPage } from "./NotFoundPage";

const STATUS_LABELS: Readonly<Record<SessionDetail["status"], string>> = {
  planned: "Planned, not started",
  active: "In progress",
  paused: "Paused",
  complete: "Complete",
  abandoned: "Ended without finishing",
};

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

/** The saved plan: words, grammar, characters, the task, and an optional colloquial expression. */
function PlanSections({ plan }: { plan: SessionPlan }) {
  return (
    <>
      {plan.kind === "free_chat" ? null : (
        <Section title="Words for this session">
          <p className="mb-3 text-mist">
            {plan.targetBand ? `${bandName(plan.targetBand)}, ` : ""}
            {plan.bandSource === "suggestion"
              ? "suggested as a starting point because you have not chosen a band. It is not a measured level."
              : "the band you chose to study. It is not a measured level."}{" "}
            Edition {plan.editionId}.
          </p>
          <ul className="border-t border-line">
            {plan.targets.map((target) => (
              <li key={target.itemId} className="border-b border-line">
                <Link
                  to={`/curriculum/item/${encodeURIComponent(target.itemId)}`}
                  className="flex min-h-14 flex-wrap items-baseline gap-x-4 py-3 hover:bg-wash"
                >
                  <span lang="zh-Hans" className="text-2xl">
                    {target.hanzi}
                  </span>
                  <span className="text-mist">{target.pinyin}</span>
                  <span className="ml-auto text-sm text-mist">
                    {TARGET_ROLE_LABELS[target.role]}
                    {target.hskBand !== plan.targetBand ? `, ${bandName(target.hskBand)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-mist">
            New: first time in a session. Review: met in an earlier session. Stretch: one band up,
            for exposure only, and never counted toward your study band. Appearing here is not
            evidence that you know a word.
          </p>
        </Section>
      )}

      {plan.colloquial.length > 0 ? (
        <Section title="Colloquial expression">
          {plan.colloquial.map((item) => (
            <div key={item.id}>
              <p>
                <span lang="zh-Hans" className="text-2xl">
                  {item.term}
                </span>
                {item.pinyin ? <span className="ml-3 text-mist">{item.pinyin}</span> : null}
              </p>
              <p className="mt-1">{item.meaningEn}</p>
              {item.warnings.length > 0 ? (
                <ul aria-label="Usage warnings" className="mt-3 space-y-1 border-l-4 border-seal bg-seal-wash px-4 py-2">
                  {item.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-sm text-mist">
                {item.synthetic ? "Test data, not a real expression. " : ""}Not HSK content, and
                never counted as HSK.
              </p>
            </div>
          ))}
        </Section>
      ) : null}

      {plan.grammar.length > 0 ? (
        <Section title="Grammar for this session">
          <ul className="border-t border-line">
            {plan.grammar.map((g) => (
              <li key={g.itemId} className="border-b border-line">
                <Link to={`/curriculum/item/${encodeURIComponent(g.itemId)}`} className="flex min-h-14 flex-wrap items-baseline gap-x-4 py-3 hover:bg-wash">
                  <span lang="zh-Hans" className="text-xl">
                    {g.name}
                  </span>
                  <span lang="zh-Hans" className="text-mist">
                    {g.grammarType}
                  </span>
                  <span className="ml-auto text-sm text-mist">{g.role === "new" ? "New" : "Coming back"}</span>
                </Link>
              </li>
            ))}
          </ul>
          {plan.grammar.some((g) => g.unverified) ? (
            <p className="mt-3 text-sm text-mist">From a second-hand transcription of the syllabus, not checked against the official document.</p>
          ) : null}
        </Section>
      ) : null}

      {plan.characters.length > 0 ? (
        <Section title="Characters">
          <p lang="zh-Hans" className="text-2xl tracking-wide">
            {plan.characters.map((c) => c.hanzi).join(" ")}
          </p>
          <p className="mt-2 text-sm text-mist">Each is shown inside a word in the Notice step.</p>
        </Section>
      ) : null}

    </>
  );
}

/** Deletes this session and its conversation after a second, explicit step (SPEC §8.4). */
function DeleteSession({ sessionId }: { sessionId: string }) {
  const remove = useDeleteSession(sessionId);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <Section title="Delete this session">
      {confirming ? (
        <div className="border-l-4 border-seal bg-seal-wash px-4 py-3">
          <p>
            Delete this session, its conversation and its listening exercise? This cannot be undone. Review cards for its
            words, and their history, are kept.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => void navigate("/", { replace: true }) })}
              className="min-h-11 rounded-md bg-seal px-4 font-semibold text-glaze disabled:opacity-60"
            >
              Yes, delete it
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-md border border-ink px-4 font-medium">
              Keep it
            </button>
          </div>
          {remove.isError ? (
            <p role="alert" className="mt-3">
              {remove.error instanceof ApiRequestError ? remove.error.message : "Something went wrong. Try again."}
            </p>
          ) : null}
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-md border border-seal px-4 font-medium text-seal">
          Delete this session…
        </button>
      )}
    </Section>
  );
}

function isSyllabusPlan(plan: SessionPlan): boolean {
  return plan.situation.sourceType === "syllabus" && plan.topic !== null && plan.task !== null;
}

function SessionView({ state }: { state: SessionStateResponse }) {
  const { session, turns, debrief, listening } = state;
  const syllabus = isSyllabusPlan(session.plan);
  const { plan } = session;
  const me = useMe();
  const { displayMode, speechRate } = me.data?.settings ?? defaultSettings();
  const tutor = me.data?.providers.find((p) => p.id === "tutor") ?? null;
  const speech = me.data?.providers.find((p) => p.id === "speech") ?? null;
  const started = session.status !== "planned";
  const ended = session.status === "complete" || session.status === "abandoned";

  const conversation = <Conversation session={session} turns={turns} displayMode={displayMode} speechRate={speechRate} tutor={tutor} speech={speech} />;
  // An ended session shows its exercise only if one was done.
  const listen =
    ended && !listening ? (
      <p className="text-mist">This session ended without a listening exercise.</p>
    ) : (
      <ListeningExercise session={session} exercise={listening} speechRate={speechRate} speech={speech} />
    );
  const summary = debrief ? (
    <>
      <SessionDebrief debrief={debrief} />
      <p className="mb-6">
        <Link to="/" className="font-medium text-cobalt underline">
          Back to Today
        </Link>
      </p>
    </>
  ) : (
    <p className="text-mist">
      {ended ? "This session was ended without finishing, so it has no summary." : "Finish the session from the Conversation step to see your summary: corrections, what you used, and what comes back when."}
    </p>
  );

  return (
    <>
      <header className="mb-6">
        <p className="text-mist">
          {session.localStudyDate} · {plan.durationMinutes} minutes · {STATUS_LABELS[session.status]}
        </p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span lang="zh-Hans" className="font-kai text-title text-cobalt-deep">
            {plan.situation.titleZh}
          </span>{" "}
          <span className="text-lg text-mist">{plan.situation.titleEn}</span>
        </h1>
        {syllabus && plan.task && plan.topic ? (
          <>
            <p className="mt-3 max-w-[60ch]">
              <span className="font-medium">Today's task: </span>
              <span lang="zh-Hans">{plan.task.canDo}</span>
            </p>
            <p className="mt-1 text-sm text-mist">
              Topic <span lang="zh-Hans">{plan.topic.area} · {plan.topic.subject}</span>, task <span lang="zh-Hans">{plan.task.task}</span>.{" "}
              {plan.task.unverified ? "From a second-hand transcription of the syllabus, not checked against the official document." : ""}
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 max-w-[60ch]">{plan.situation.communicativeGoal}</p>
            <p className="mt-1 text-sm text-mist">This situation was written for ShuoLab. It is not an HSK topic or task.</p>
          </>
        )}
      </header>

      {plan.synthetic ? (
        <div className="mb-6">
          <SyntheticDataNotice />
        </div>
      ) : null}

      {plan.kind === "free_chat" ? (
        <p className="mb-6 border-l-4 border-cobalt bg-wash px-4 py-3">
          <span className="font-semibold">Open conversation, not an HSK lesson.</span> Nothing here
          is tied to the syllabus, and it does not count toward HSK coverage.
        </p>
      ) : null}

      {session.status === "abandoned" ? (
        <p className="mb-6 border-l-4 border-line bg-wash px-4 py-3">
          This session was ended without finishing, so it has no summary.{" "}
          <Link to="/" className="font-medium text-cobalt underline">
            Start a new one from Today
          </Link>
        </p>
      ) : null}

      {/* Before starting, the targets come first; once started, they fold away under the steps. */}
      {started ? null : <PlanSections plan={plan} />}
      <SessionSpine state={state} listen={listen} conversation={conversation} summary={summary} />
      {started ? (
        <details className="mt-6 border-t border-line pt-4">
          <summary className="min-h-11 cursor-pointer font-medium text-cobalt">Today's words, grammar and characters</summary>
          <PlanSections plan={plan} />
        </details>
      ) : null}
      <DeleteSession sessionId={session.id} />
    </>
  );
}

function SessionLoader({ id }: { id: string }) {
  const session = useSession(id);
  return (
    <AsyncStatus
      isPending={session.isPending}
      error={session.error}
      onRetry={() => void session.refetch()}
      label="this session"
    >
      {session.data ? <SessionView state={session.data} /> : null}
    </AsyncStatus>
  );
}

export function SessionPage() {
  const { sessionId = "" } = useParams();
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) {
    return <NotFoundPage />;
  }
  return (
    <>
      <p className="mb-2">
        <Link to="/" className="font-medium text-cobalt underline">
          Today
        </Link>
      </p>
      <SessionLoader key={sessionId} id={sessionId} />
    </>
  );
}
