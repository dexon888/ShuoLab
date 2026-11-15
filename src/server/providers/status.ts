import type { ProviderMode, ProviderStatus } from "../../shared/api";
import { hasValue, isProduction, type Env } from "../env";

import { DEFAULT_OPENAI_MODEL } from "./select";

function mode(configured: boolean, env: Env): ProviderMode {
  if (configured) return "live";
  return isProduction(env) ? "missing" : "mock";
}

/**
 * Describes which providers are usable without revealing any secret. `live`
 * means a credential is present, not that the provider has been exercised.
 */
export function getProviderStatuses(env: Env): ProviderStatus[] {
  const tutorMode = mode(hasValue(env.OPENAI_API_KEY), env);
  const speechMode = mode(hasValue(env.AZURE_SPEECH_KEY) && hasValue(env.AZURE_SPEECH_REGION), env);

  return [
    {
      id: "tutor",
      vendor: tutorMode === "mock" ? "Local fake tutor" : "OpenAI",
      mode: tutorMode,
      model: tutorMode === "mock" ? null : (env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL),
      setupHint:
        tutorMode === "missing"
          ? "Add the OPENAI_API_KEY secret with `wrangler secret put OPENAI_API_KEY`."
          : null,
    },
    {
      id: "speech",
      vendor: speechMode === "mock" ? "Local fake speech" : "Azure AI Speech",
      mode: speechMode,
      model: null,
      setupHint:
        speechMode === "missing"
          ? "Add the AZURE_SPEECH_KEY secret and set AZURE_SPEECH_REGION. Typed answers still work without it."
          : null,
    },
  ];
}
