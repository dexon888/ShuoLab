import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { ProviderStatusList } from "../components/ProviderStatusList";
import { NotBuiltYet, Section } from "../components/Section";
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
            <Section title="Preferences, limits, export and deletion">
              <NotBuiltYet phase={2}>
                Session length, speech rate, help level and monthly spending limits are saved here.
                Export and deletion follow in Phase 4.
              </NotBuiltYet>
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
