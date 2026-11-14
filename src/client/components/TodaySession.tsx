import { Link, useNavigate } from "react-router";
import type { MeResponse } from "../../shared/api";
import type { PlanRequest, SessionSummary } from "../../shared/session";
import { usePlanSession, useSessions } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";

const STATUS_LABELS: Readonly<Record<SessionSummary["status"], string>> = {
  planned: "Planned",
  active: "In progress",
  paused: "Paused",
  complete: "Complete",
  abandoned: "Replaced",
};

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

function describe(session: SessionSummary): string {
  const kind = session.kind === "free_chat" ? "Open conversation" : session.targetBand ? bandName(session.targetBand) : "HSK";
  return `${kind}, ${session.durationMinutes} minutes`;
}

/** Today's session: start it, or pick up the one already planned. */
export function TodaySession({ me }: { me: MeResponse }) {
  const sessions = useSessions();
  const plan = usePlanSession();
  const navigate = useNavigate();
  const { settings, curriculumImported } = me;
  const resumable = sessions.data?.resumable ?? null;
  const recent = (sessions.data?.sessions ?? []).filter((s) => s.id !== resumable?.id);

  const start = (request: PlanRequest) =>
    plan.mutate(request, { onSuccess: ({ session }) => void navigate(`/session/${session.id}`) });

  const error = plan.error
    ? plan.error instanceof ApiRequestError
      ? plan.error.message
      : "Something went wrong. Try again."
    : null;

  return (
    <>
      {resumable ? (
        <div className="mb-4 border-l-4 border-jade bg-wash px-4 py-3">
          <p className="font-semibold">
            <span lang="zh-Hans">{resumable.situationTitleZh}</span> · {resumable.situationTitleEn}
          </p>
          <p className="text-mist">
            {describe(resumable)} · {STATUS_LABELS[resumable.status]}
          </p>
          <p className="mt-2">
            <Link to={`/session/${resumable.id}`} className="font-medium text-cobalt underline">
              {resumable.status === "planned" ? "Open today's plan" : "Resume today's session"}
            </Link>
          </p>
        </div>
      ) : null}

      {curriculumImported ? (
        resumable ? null : (
          <>
            <button
              type="button"
              disabled={plan.isPending}
              onClick={() => start({})}
              className="min-h-12 w-full rounded-md bg-cobalt px-5 text-lg font-semibold text-glaze hover:bg-cobalt-deep disabled:opacity-60 sm:w-auto"
            >
              {plan.isPending ? "Planning…" : "Start today's session"}
            </button>
            <p className="mt-3 text-mist">
              {settings.sessionMinutes} minutes,{" "}
              {settings.studyBand
                ? `${bandName(settings.studyBand)} (your chosen band)`
                : "starting from HSK 1 as a suggestion, since no band is chosen"}
              .{" "}
              <Link to="/settings" className="font-medium text-cobalt underline">
                Change
              </Link>
            </p>
          </>
        )
      ) : (
        <>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby="session-unavailable"
            className="min-h-12 w-full cursor-not-allowed rounded-md bg-line px-5 text-lg font-semibold text-mist sm:w-auto"
          >
            Start today's session
          </button>
          <p id="session-unavailable" className="mt-3 text-mist">
            Guided HSK sessions need the real HSK vocabulary, which has not been imported yet.
          </p>
          {resumable ? null : (
            <p className="mt-4">
              <button
                type="button"
                disabled={plan.isPending}
                onClick={() => start({ freeChat: true })}
                className="min-h-11 rounded-md border border-cobalt px-5 font-semibold text-cobalt hover:bg-wash disabled:opacity-60"
              >
                Plan an open conversation instead
              </button>
              <span className="mt-2 block text-sm text-mist">
                Not an HSK lesson: no syllabus words, and nothing counts toward HSK coverage.
              </span>
            </p>
          )}
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
          Couldn't plan a session. {error}
        </p>
      ) : null}

      {recent.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 font-semibold">Recent sessions</h3>
          <ul className="border-t border-line">
            {recent.map((session) => (
              <li key={session.id} className="border-b border-line">
                <Link to={`/session/${session.id}`} className="flex min-h-11 flex-wrap items-baseline gap-x-3 py-2 hover:bg-wash">
                  <span className="tabular-nums text-mist">{session.localStudyDate}</span>
                  <span>{session.situationTitleEn}</span>
                  <span className="ml-auto text-sm text-mist">
                    {describe(session)} · {STATUS_LABELS[session.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
