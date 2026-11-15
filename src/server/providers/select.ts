import { hasValue, isProduction, type Env } from "../env";
import { ApiError } from "../validation/errors";
import { AzureSpeechTokenProvider, isValidAzureRegion } from "./azure";
import { FakeSpeechTokenProvider, FakeTutorProvider } from "./fake";
import { OpenAiTutorProvider, type TokenPrices } from "./openai";
import type { SpeechTokenProvider, TutorProvider } from "./types";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

/**
 * Standard-tier list prices in US dollars per million tokens, read from
 * OpenAI's pricing page on 2026-11-14. Prices change: override them with
 * OPENAI_INPUT_USD_PER_MTOK and OPENAI_OUTPUT_USD_PER_MTOK when they do.
 */
const KNOWN_PRICES: Readonly<Record<string, TokenPrices>> = {
  "gpt-6-luna": { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
};

function parsePrice(value: string | undefined): number | null {
  if (!hasValue(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
}

/** Prices for a model, or null when none are known and none are configured. */
export function resolvePrices(env: Pick<Env, "OPENAI_INPUT_USD_PER_MTOK" | "OPENAI_OUTPUT_USD_PER_MTOK">, model: string): TokenPrices | null {
  const input = parsePrice(env.OPENAI_INPUT_USD_PER_MTOK);
  const output = parsePrice(env.OPENAI_OUTPUT_USD_PER_MTOK);
  if (input !== null && output !== null) return { inputUsdPerMTok: input, outputUsdPerMTok: output };
  // One override without the other is a mistake, not a partial setting.
  if (hasValue(env.OPENAI_INPUT_USD_PER_MTOK) || hasValue(env.OPENAI_OUTPUT_USD_PER_MTOK)) return null;
  return KNOWN_PRICES[model] ?? null;
}

/**
 * Chooses the tutor at request time. With a key: OpenAI. Without one: the
 * local stand-in in development and tests, and nothing in production.
 */
export function selectTutorProvider(env: Env): TutorProvider {
  if (hasValue(env.OPENAI_API_KEY)) {
    const model = hasValue(env.OPENAI_MODEL) ? env.OPENAI_MODEL.trim() : DEFAULT_OPENAI_MODEL;
    const prices = resolvePrices(env, model);
    if (!prices) {
      // Without a price the spend cannot be estimated, so the budget cannot be enforced.
      throw new ApiError(
        "PROVIDER_UNAVAILABLE",
        "The tutor model has no price configured, so spending cannot be tracked. Set OPENAI_INPUT_USD_PER_MTOK and OPENAI_OUTPUT_USD_PER_MTOK.",
      );
    }
    return new OpenAiTutorProvider({ apiKey: env.OPENAI_API_KEY.trim(), model, prices });
  }
  if (isProduction(env)) {
    throw new ApiError("PROVIDER_UNAVAILABLE", "The tutor is not set up. Add the OPENAI_API_KEY secret.");
  }
  return new FakeTutorProvider();
}

/**
 * Chooses the speech token issuer at request time. With a key and region:
 * Azure. Without: the local stand-in in development and tests, and nothing in
 * production, where typed answers still work.
 */
export function selectSpeechProvider(env: Env): SpeechTokenProvider {
  if (hasValue(env.AZURE_SPEECH_KEY) && hasValue(env.AZURE_SPEECH_REGION)) {
    const region = env.AZURE_SPEECH_REGION.trim().toLowerCase();
    if (!isValidAzureRegion(region)) {
      throw new ApiError(
        "PROVIDER_UNAVAILABLE",
        "AZURE_SPEECH_REGION is not a region name such as eastus. Typed answers still work.",
      );
    }
    return new AzureSpeechTokenProvider({ key: env.AZURE_SPEECH_KEY.trim(), region });
  }
  if (isProduction(env)) {
    throw new ApiError(
      "PROVIDER_UNAVAILABLE",
      "Speech is not set up. Add the AZURE_SPEECH_KEY secret and set AZURE_SPEECH_REGION. Typed answers still work.",
    );
  }
  return new FakeSpeechTokenProvider();
}
