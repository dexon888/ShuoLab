import { Link } from "react-router";
import { AsyncStatus } from "../components/AsyncStatus";
import { CurriculumImportNotice } from "../components/CurriculumImportNotice";
import { PageHeader } from "../components/PageHeader";
import { ProviderStatusList } from "../components/ProviderStatusList";
import { Section } from "../components/Section";
import { TodaySession } from "../components/TodaySession";
import { UsageBudgetMeter } from "../components/UsageBudgetMeter";
import { useCurriculumStatus, useDueReviews, useMe, useMonthlyUsage, useOnramp, useProgressSummary } from "../hooks/queries";
import { MIN_OBSERVATIONS, type ProgressSummary } from "../../shared/progress";

/** This week's communication evidence, kept apart from HSK coverage. */
function WeekInBrief({ s }: { s: ProgressSummary }) {
  const { practice, listening, speaking } = s;
  return (
    <ul className="space-y-1">
      <li>
        <span className="font-semibold tabular-nums">{practice.totalMinutes}</span> minutes of practice on{" "}
        {practice.activeDays} of the last 7 days.
      </li>
      <li>
        {listening.checks === 0
          ? "No listening checks this week."
          : `${listening.correct} of ${listening.questions} listening questions right in ${listening.checks} check${listening.checks === 1 ? "" : "s"}`}
        {listening.checks > 0 && listening.checks < MIN_OBSERVATIONS ? " (too few for an accuracy figure)." : listening.checks > 0 ? "." : ""}
      </li>
      <li>
        {speaking.spokenTurns} spoken turn{speaking.spokenTurns === 1 ? "" : "s"}, {speaking.typedTurns} typed.
      </li>
      <li>
        {s.meaningfulDays.count} meaningful day{s.meaningfulDays.count === 1 ? "" : "s"}: you both produced something and recalled something in review.
      </li>
    </ul>
  );
}

/** Entries met and mastered, against the imported denominator. */
function CoverageBrief({ s }: { s: ProgressSummary }) {
  const { total } = s.hsk;
  if (!s.hsk.editionId) return null;
  const mastered = (["listening", "reading"] as const).map((k) => `${k} ${total.bySkill[k].mastered}`).join(", ");
  return (
    <p className="mt-3">
      Met <span className="font-semibold tabular-nums">{total.introduced}</span> of {total.entries} entries
      {s.hsk.synthetic ? " (placeholder words)" : ""}. Mastered: {mastered}.
    </p>
  );
}

export function DashboardPage() {
  const me = useMe();
  const curriculum = useCurriculumStatus();
  const week = useProgressSummary(7);
  const due = useDueReviews();
  const usage = useMonthlyUsage();
  const onramp = useOnramp();

  return (
    <>
      <PageHeader zh="今天" en="Today" />

      {me.data && !me.data.settings.onboardedAt ? (
        <p className="mb-6 border-l-4 border-cobalt bg-wash px-4 py-3">
          <span className="font-semibold">Set up your preferences.</span> Choose your session
          length, reading help and study band.{" "}
          <Link to="/onboarding" className="font-medium text-cobalt underline">
            Get started
          </Link>
        </p>
      ) : null}

      {onramp.data && !onramp.data.checkPassed ? (
        <p className="mb-6 border-l-4 border-cobalt bg-wash px-4 py-3">
          <span className="font-semibold">New to Chinese? Start with the sounds.</span> Pinyin, the four tones and
          typing Chinese, before your first sessions{onramp.data.units.length > 0 ? " (you have started)" : ""}.{" "}
          <Link to="/start" className="font-medium text-cobalt underline">
            Start here
          </Link>
        </p>
      ) : null}

      <Section title="Today's session">
        {me.data ? (
          <TodaySession me={me.data} />
        ) : (
          // The Services section below reports a loading failure; it is not repeated here.
          <p className="text-mist">{me.isPending ? "Loading…" : "Unavailable until ShuoLab loads. See Services below."}</p>
        )}
      </Section>

      <Section title="HSK curriculum">
        <AsyncStatus
          isPending={curriculum.isPending}
          error={curriculum.error}
          onRetry={() => void curriculum.refetch()}
          label="curriculum status"
        >
          {curriculum.data ? <CurriculumImportNotice status={curriculum.data} /> : null}
          <p className="mt-3">
            <Link to="/curriculum" className="font-medium text-cobalt underline">
              See what is imported, band by band
            </Link>
          </p>
        </AsyncStatus>
        {week.data ? <CoverageBrief s={week.data} /> : null}
      </Section>

      {due.data && due.data.totalCards > 0 ? (
        <Section title="Review">
          <p>
            {due.data.dueCount > 0 ? (
              <>
                <span className="font-semibold tabular-nums">{due.data.dueCount}</span> card{due.data.dueCount === 1 ? "" : "s"} due.{" "}
                <Link to="/review" className="font-medium text-cobalt underline">
                  Review now
                </Link>
              </>
            ) : (
              "Nothing due."
            )}
          </p>
        </Section>
      ) : null}

      <Section title="Communication progress">
        <AsyncStatus isPending={week.isPending} error={week.error} onRetry={() => void week.refetch()} label="this week's progress">
          {week.data ? <WeekInBrief s={week.data} /> : null}
        </AsyncStatus>
        <p className="mt-2 text-mist">
          Measured separately from HSK coverage, and neither one is an HSK exam score.{" "}
          <Link to="/progress" className="font-medium text-cobalt underline">
            See progress
          </Link>
        </p>
      </Section>

      <Section title="Services">
        <AsyncStatus
          isPending={me.isPending}
          error={me.error}
          onRetry={() => void me.refetch()}
          label="service status"
        >
          {me.data ? <ProviderStatusList providers={me.data.providers} /> : null}
        </AsyncStatus>
        {usage.data ? (
          <div className="mt-4">
            <h3 className="mb-1 font-semibold">AI spending this month (estimate)</h3>
            <UsageBudgetMeter estimatedUsd={usage.data.estimatedUsd} softUsd={usage.data.softUsd} hardUsd={usage.data.hardUsd} />
            {usage.data.hardLimitReached ? (
              <p className="mt-1 text-sm font-semibold">Stop amount reached: paid tutor requests are paused.</p>
            ) : usage.data.softLimitReached ? (
              <p className="mt-1 text-sm font-semibold">Warning amount reached.</p>
            ) : null}
            <p className="mt-1 text-sm">
              <Link to="/settings" className="font-medium text-cobalt underline">
                Change the amounts in Settings
              </Link>
            </p>
          </div>
        ) : null}
      </Section>
    </>
  );
}
