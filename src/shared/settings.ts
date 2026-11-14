/**
 * Owner preferences (SPEC §5.1, §5.7). One owner, one settings row. The
 * schemas here are the whitelist: a field that is not listed cannot be saved.
 */
import { z } from "zod";
import { HSK_BANDS } from "./curriculum";
import { SESSION_MINUTE_OPTIONS } from "./learning";

/** How much reading help is shown with Chinese text. */
export const DISPLAY_MODES = ["hanzi", "hanzi_pinyin", "hanzi_pinyin_english"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const DISPLAY_MODE_LABELS: Readonly<Record<DisplayMode, string>> = {
  hanzi: "Characters only",
  hanzi_pinyin: "Characters with pinyin",
  hanzi_pinyin_english: "Characters, pinyin and English",
};

export const SLANG_INTENSITIES = ["low", "normal", "high"] as const;
export type SlangIntensity = (typeof SLANG_INTENSITIES)[number];

export const SLANG_INTENSITY_LABELS: Readonly<Record<SlangIntensity, string>> = {
  low: "Low: almost none",
  normal: "Normal: a little, with warnings",
  high: "High: more everyday slang, with warnings",
};

/** Self-description only. Never treated as a measured level. */
export const SELF_RATINGS = ["none", "basic", "conversational", "comfortable"] as const;
export type SelfRating = (typeof SELF_RATINGS)[number];

export const SELF_RATING_LABELS: Readonly<Record<SelfRating, string>> = {
  none: "Almost nothing yet",
  basic: "Simple, slow sentences",
  conversational: "Everyday conversation with effort",
  comfortable: "Comfortable in most situations",
};

export const SPEECH_RATE_MIN = 0.75;
export const SPEECH_RATE_MAX = 1.15;
export const SPEECH_RATE_STEP = 0.05;

export const LIMIT_USD_MAX = 500;
export const DEFAULT_SOFT_LIMIT_USD = 5;
export const DEFAULT_HARD_LIMIT_USD = 10;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const sessionMinutesSchema = z.union(
  SESSION_MINUTE_OPTIONS.map((m) => z.literal(m)) as [z.ZodLiteral<15>, z.ZodLiteral<20>, z.ZodLiteral<25>, z.ZodLiteral<30>],
);

const usd = z
  .number()
  .min(0)
  .max(LIMIT_USD_MAX)
  .refine((v) => Math.round(v * 100) === v * 100 || Math.abs(Math.round(v * 100) - v * 100) < 1e-6, {
    message: "At most two decimal places.",
  });

export const spendingLimitsSchema = z.object({
  /** Warn when this month's estimated spend reaches this amount. */
  softUsd: usd,
  /** Stop paid tutor requests when this month's estimated spend reaches this amount. */
  hardUsd: usd,
});
export type SpendingLimits = z.infer<typeof spendingLimitsSchema>;

const fields = {
  nickname: z.string().trim().min(1).max(40).nullable(),
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, { message: "Unknown time zone." }),
  sessionMinutes: sessionMinutesSchema,
  /** The band to study. Null means not chosen: the planner then suggests HSK 1. */
  studyBand: z.enum(HSK_BANDS).nullable(),
  displayMode: z.enum(DISPLAY_MODES),
  speechRate: z
    .number()
    .min(SPEECH_RATE_MIN)
    .max(SPEECH_RATE_MAX)
    .transform((v) => Math.round(v * 100) / 100),
  slangIntensity: z.enum(SLANG_INTENSITIES),
  selfRatedListening: z.enum(SELF_RATINGS).nullable(),
  selfRatedSpeaking: z.enum(SELF_RATINGS).nullable(),
  limits: spendingLimitsSchema.refine((l) => l.softUsd <= l.hardUsd, {
    message: "The warning amount cannot be above the stop amount.",
    path: ["softUsd"],
  }),
};

export const ownerSettingsSchema = z.object({
  ...fields,
  /** Written Chinese is Simplified; not editable yet. */
  locale: z.literal("zh-Hans"),
  /** When onboarding was finished or skipped; null until then. */
  onboardedAt: z.string().nullable(),
  /** Null until the owner has saved anything. */
  updatedAt: z.string().nullable(),
});
export type OwnerSettings = z.infer<typeof ownerSettingsSchema>;

/** Body of PUT /settings: any subset of the editable fields, and nothing else. */
export const settingsUpdateSchema = z
  .object({
    ...fields,
    /** True marks onboarding as finished (or skipped). It cannot be undone through the API. */
    onboarded: z.literal(true),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to update." });
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const settingsResponseSchema = z.object({ settings: ownerSettingsSchema });
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const DEFAULT_TIME_ZONE = "UTC";

/** What applies before the owner has saved anything. */
export function defaultSettings(): OwnerSettings {
  return {
    nickname: null,
    locale: "zh-Hans",
    timezone: DEFAULT_TIME_ZONE,
    sessionMinutes: 20,
    studyBand: null,
    displayMode: "hanzi_pinyin",
    speechRate: 1,
    slangIntensity: "normal",
    selfRatedListening: null,
    selfRatedSpeaking: null,
    limits: { softUsd: DEFAULT_SOFT_LIMIT_USD, hardUsd: DEFAULT_HARD_LIMIT_USD },
    onboardedAt: null,
    updatedAt: null,
  };
}
