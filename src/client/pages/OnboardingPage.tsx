import { Link, useNavigate } from "react-router";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { PreferencesForm } from "../components/PreferencesForm";
import { ProviderStatusList } from "../components/ProviderStatusList";
import { Section } from "../components/Section";
import { useMe, useUpdateSettings } from "../hooks/queries";

export function OnboardingPage() {
  const me = useMe();
  const skip = useUpdateSettings();
  const navigate = useNavigate();
  const done = () => void navigate("/");

  return (
    <>
      <PageHeader
        zh="开始"
        en="Getting started"
        summary="A few choices so sessions fit you. Everything here can be changed later in Settings."
      />
      <AsyncStatus isPending={me.isPending} error={me.error} onRetry={() => void me.refetch()} label="your settings">
        {me.data ? (
          <>
            {me.data.settings.onboardedAt ? (
              <p className="mb-6 border-l-4 border-jade bg-wash px-4 py-3">
                You have already set this up. Saving again updates your settings.
              </p>
            ) : null}

            {!me.data.curriculumImported ? (
              <p className="mb-6 border-l-4 border-line bg-wash px-4 py-3">
                <span className="font-semibold">Curriculum not imported.</span> You can set your
                preferences now; guided HSK sessions also need the vocabulary import.{" "}
                <Link to="/curriculum" className="font-medium text-cobalt underline">
                  See the curriculum page
                </Link>
              </p>
            ) : null}

            <PreferencesForm settings={me.data.settings} mode="onboarding" onSaved={done} />

            <div className="mt-8">
              <Section title="Placement check">
                <p className="text-mist">
                  A short listening and reading sample that suggests a starting band is planned for
                  later and is not built. For now you choose the band yourself, and it is treated
                  as your choice, not as a measured level.
                </p>
              </Section>
              <Section title="Services">
                <ProviderStatusList providers={me.data.providers} />
              </Section>
            </div>

            {!me.data.settings.onboardedAt ? (
              <p className="mt-6">
                <button
                  type="button"
                  disabled={skip.isPending}
                  onClick={() => skip.mutate({ onboarded: true }, { onSuccess: done })}
                  className="min-h-11 rounded-md border border-mist px-5 font-medium hover:bg-wash disabled:opacity-60"
                >
                  Skip for now and use the defaults
                </button>
                {skip.error ? (
                  <span role="alert" className="mt-2 block text-seal">
                    Couldn't skip. Try again.
                  </span>
                ) : null}
              </p>
            ) : null}
          </>
        ) : null}
      </AsyncStatus>
    </>
  );
}
