import type { D1Database } from "@cloudflare/workers-types";

/** Worker bindings and runtime configuration. Secrets are read only here, at request time. */
export interface Env {
  DB: D1Database;

  /** "production" unless explicitly overridden; anything else but development/test is treated as production. */
  APP_ENV?: string;
  /** Local development only. Fails closed outside development/test. */
  DEV_AUTH_BYPASS?: string;

  OWNER_EMAIL?: string;
  /** e.g. https://your-team.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application. */
  ACCESS_AUD?: string;

  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  /** Optional price overrides, US dollars per million tokens. Set both or neither. */
  OPENAI_INPUT_USD_PER_MTOK?: string;
  OPENAI_OUTPUT_USD_PER_MTOK?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  /** Optional lower monthly limits for speech, below the Azure free allowance. */
  AZURE_RECOGNITION_SECONDS_PER_MONTH?: string;
  AZURE_SYNTHESIS_CHARS_PER_MONTH?: string;
}

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";

/** Only an explicit development/test value opts out of production behaviour. */
export function isProduction(env: Pick<Env, "APP_ENV">): boolean {
  return env.APP_ENV !== "development" && env.APP_ENV !== "test";
}

export function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
