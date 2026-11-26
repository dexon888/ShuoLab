import { Link } from "react-router";
import { AsyncStatus } from "../components/AsyncStatus";
import { MonthlyUsage } from "../components/MonthlyUsage";
import { PageHeader } from "../components/PageHeader";
import { PreferencesForm } from "../components/PreferencesForm";
import { ProviderStatusList } from "../components/ProviderStatusList";
import { Section } from "../components/Section";
import { YourData } from "../components/YourData";
import { useMe } from "../hooks/queries";

export function SettingsPage() {
  const me = useMe();

  return (
    <>
      <PageHeader zh="设置" en="Settings" />
      <AsyncStatus
        isPending={me.isPending}
        error={me.error}
        onRetry={() => void me.refetch()}
        label="settings"
      >
        {me.data ? (
          <>
            <Section title="Account">
              <p>
                {me.data.owner.authMode === "dev-bypass"
                  ? "Local development: sign-in is skipped on this computer only."
                  : `Signed in as ${me.data.owner.email ?? "the owner"} through Cloudflare Access.`}
              </p>
            </Section>
            <Section title="Services">
              <ProviderStatusList providers={me.data.providers} />
              <p className="mt-3 text-sm text-mist">
                The real tutor and speech services need your own OpenAI and Azure accounts, which
                may charge for use.
              </p>
            </Section>
            <Section title="Spending this month">
              <MonthlyUsage />
            </Section>
            <div className="border-t border-line py-6">
              <PreferencesForm settings={me.data.settings} mode="settings" />
            </div>
            <Section title="Curriculum sources and credits">
              <p>
                <Link to="/curriculum" className="font-medium text-cobalt underline">
                  Imported data, sources and licences
                </Link>
              </p>
            </Section>
            <Section title="Your data">
              <YourData settings={me.data.settings} />
            </Section>
            <Section title="About">
              <p>ShuoLab version {me.data.version}</p>
            </Section>
          </>
        ) : null}
      </AsyncStatus>
    </>
  );
}
