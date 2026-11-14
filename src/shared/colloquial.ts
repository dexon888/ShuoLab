/**
 * Colloquial expressions: a content track separate from the HSK syllabus
 * (SPEC §2.3). These rows have no HSK band and are never part of any HSK
 * count or coverage figure.
 */

export const COLLOQUIAL_REGISTERS = ["formal", "neutral", "casual", "very_informal"] as const;
export type ColloquialRegister = (typeof COLLOQUIAL_REGISTERS)[number];

export const COLLOQUIAL_CHANNELS = ["spoken", "typed", "both"] as const;
export type ColloquialChannel = (typeof COLLOQUIAL_CHANNELS)[number];

export const CURRENCY_STATUSES = ["hot", "steady", "fading", "unknown"] as const;
export type CurrencyStatus = (typeof CURRENCY_STATUSES)[number];

export interface ColloquialSource {
  key: string;
  name: string;
  homepage: string | null;
  datasetUrl: string | null;
  license: string;
  licenseUrl: string | null;
  /** Credit line shown wherever the expressions appear. */
  attribution: string;
  /** Generated placeholder rows for development and tests. */
  synthetic: boolean;
}

export const HEARMANDARIN_SOURCE_KEY = "hearmandarin";
export const SYNTHETIC_COLLOQUIAL_SOURCE_KEY = "synthetic-fixture";

export const COLLOQUIAL_SOURCES: Readonly<Record<string, ColloquialSource>> = {
  [HEARMANDARIN_SOURCE_KEY]: {
    key: HEARMANDARIN_SOURCE_KEY,
    name: "HearMandarin",
    homepage: "https://hearmandarin.com",
    datasetUrl: "https://hearmandarin.com/datasets/chinese-slang/",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "HearMandarin (https://hearmandarin.com)",
    synthetic: false,
  },
  [SYNTHETIC_COLLOQUIAL_SOURCE_KEY]: {
    key: SYNTHETIC_COLLOQUIAL_SOURCE_KEY,
    name: "ShuoLab synthetic test fixture",
    homepage: null,
    datasetUrl: null,
    license: "Not applicable",
    licenseUrl: null,
    attribution: "Generated placeholder rows. Not real expressions.",
    synthetic: true,
  },
};

export function getColloquialSource(key: string): ColloquialSource | undefined {
  return Object.hasOwn(COLLOQUIAL_SOURCES, key) ? COLLOQUIAL_SOURCES[key] : undefined;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function isColloquialSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/** Stable identity: `colloquial:<source>:<slug>`. Never an HSK item id. */
export function makeColloquialId(sourceKey: string, slug: string): string {
  return `colloquial:${sourceKey}:${slug}`;
}

const ID_PATTERN = /^colloquial:[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9_-]{0,79}$/;

export function isColloquialId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export const REGISTER_LABELS: Readonly<Record<ColloquialRegister, string>> = {
  formal: "Formal",
  neutral: "Fine with anyone",
  casual: "Casual",
  very_informal: "Very informal",
};

export const CHANNEL_LABELS: Readonly<Record<ColloquialChannel, string>> = {
  spoken: "Spoken",
  typed: "Typed only",
  both: "Spoken and typed",
};

export const CURRENCY_LABELS: Readonly<Record<CurrencyStatus, string>> = {
  hot: "In heavy use now",
  steady: "Everyday, established",
  fading: "Fading",
  unknown: "Currency not verified",
};

export interface UsageFacts {
  register: ColloquialRegister;
  channel: ColloquialChannel;
  currencyStatus: CurrencyStatus;
  verificationStatus: "verified" | "unverified";
}

/**
 * Warnings shown with an expression so it is not used in the wrong company
 * (SPEC §2.3, §6.5). The wording is ShuoLab's own, derived from the tags.
 */
export function usageWarnings(facts: UsageFacts): string[] {
  const warnings: string[] = [];
  if (facts.verificationStatus === "unverified") {
    warnings.push("Not verified against a source. Treat it as a suggestion, not as established usage.");
  }
  if (facts.register === "very_informal") {
    warnings.push("Carries a swear or insult. Only with close friends who talk the same way.");
  } else if (facts.register === "casual") {
    warnings.push("Casual. Avoid with elders, clients, teachers and officials.");
  }
  if (facts.channel === "typed") {
    warnings.push("Typed only. Saying it out loud sounds odd or like a joke.");
  } else if (facts.channel === "spoken") {
    warnings.push("Spoken only. It looks out of place in writing.");
  }
  if (facts.currencyStatus === "fading") {
    warnings.push("Fading. Still understood, but it can make you sound dated.");
  } else if (facts.currencyStatus === "hot") {
    warnings.push("Current slang. It may not last, and not everyone will know it.");
  } else if (facts.currencyStatus === "unknown") {
    warnings.push("How current this is has not been verified.");
  }
  return warnings;
}
