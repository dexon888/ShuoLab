import { Link, useParams } from "react-router";
import { TARGET_ROLE_LABELS, listeningSpeakingShare, type SessionDetail } from "../../shared/session";
import { AsyncStatus } from "../components/AsyncStatus";
import { NotBuiltYet, Section } from "../components/Section";
import { SyntheticDataNotice } from "../components/SyntheticDataNotice";
import { useSession } from "../hooks/queries";
import { NotFoundPage } from "./NotFoundPage";

const STATUS_LABELS: Readonly<Record<SessionDetail["status"], string>> = {
  planned: "Planned, not started",
  active: "In progress",
  paused: "Paused",
  complete: "Complete",
  abandoned: "Replaced by a newer plan",
};

const SKILL_LABELS = { listening: "Listening", speaking: "Speaking", reading: "Reading", writing: "Writing" } as const;

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

function SessionPlanView({ session }: { session: SessionDetail }) {
  const { plan } = session;
  const oralShare = Math.round(listeningSpeakingShare(plan.activities) * 100);

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
        <p className="mt-3 max-w-[60ch]">{plan.situation.communicativeGoal}</p>
        <p className="mt-1 text-sm text-mist">
          This situation was written for ShuoLab. It is not an HSK topic or task.
        </p>
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
      ) : (
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

      <Section title="Plan">
        <ol className="border-t border-line">
          {plan.activities.map((activity) => (
            <li key={activity.kind} className="flex flex-wrap items-baseline gap-x-4 border-b border-line py-3">
              <span className="w-20 shrink-0 font-medium tabular-nums">
                {activity.minutes} min
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{activity.title}</span>
                <span className="block text-mist">{activity.description}</span>
              </span>
              <span className="text-sm text-mist">{SKILL_LABELS[activity.skill]}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-mist">
          {oralShare}% of the time is listening and speaking. Times are a guide, not a cut-off.
        </p>
      </Section>

      <Section title="Conversation">
        <NotBuiltYet phase={2}>
          The plan is saved and ready. The typed conversation with the tutor that runs it is the
          next part of the build.
        </NotBuiltYet>
      </Section>
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
      {session.data ? <SessionPlanView session={session.data.session} /> : null}
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
