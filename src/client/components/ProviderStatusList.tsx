import type { ProviderMode, ProviderStatus } from "../../shared/api";

const PROVIDER_NAMES: Record<ProviderStatus["id"], string> = {
  tutor: "Conversation tutor",
  speech: "Speech recognition and voice",
};

const MODE_LABELS: Record<ProviderMode, string> = {
  live: "Key configured",
  mock: "Practice stand-in",
  missing: "Not set up",
};

const MODE_NOTES: Record<ProviderMode, string> = {
  live: "A key is set. This has not been confirmed with a real request yet.",
  mock: "A local stand-in answers instead of the real service. Nothing is sent out and nothing is billed.",
  missing: "",
};

export function ProviderStatusList({ providers }: { providers: ProviderStatus[] }) {
  return (
    <ul className="divide-y divide-line">
      {providers.map((provider) => (
        <li key={provider.id} className="py-3">
          <p className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="font-medium">{PROVIDER_NAMES[provider.id]}</span>
            <span className={provider.mode === "missing" ? "font-semibold text-seal" : "text-mist"}>
              {MODE_LABELS[provider.mode]}
            </span>
          </p>
          <p className="mt-1 text-sm text-mist">
            {provider.vendor}
            {provider.model ? `, model ${provider.model}` : ""}.{" "}
            {provider.setupHint ?? MODE_NOTES[provider.mode]}
          </p>
        </li>
      ))}
    </ul>
  );
}
