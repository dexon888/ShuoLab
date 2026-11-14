import { Link } from "react-router";
import { AsyncStatus } from "../components/AsyncStatus";
import { CurriculumImportNotice } from "../components/CurriculumImportNotice";
import { PageHeader } from "../components/PageHeader";
import { ProviderStatusList } from "../components/ProviderStatusList";
import { Section } from "../components/Section";
import { TodaySession } from "../components/TodaySession";
import { useCurriculumStatus, useMe } from "../hooks/queries";

export function DashboardPage() {
  const me = useMe();
  const curriculum = useCurriculumStatus();

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
      </Section>

      <Section title="Communication progress">
        <p>No evidence yet.</p>
        <p className="mt-1 text-mist">
          Listening checks and speaking turns will be counted here once you have completed sessions.
          This is measured separately from HSK coverage, and neither one is an HSK exam score.
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
      </Section>
    </>
  );
}
