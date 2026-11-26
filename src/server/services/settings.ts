import type { D1Database } from "@cloudflare/workers-types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  defaultSettings,
  ownerSettingsSchema,
  spendingLimitsSchema,
  type OwnerSettings,
  type SettingsUpdate,
} from "../../shared/settings";
import { ownerSettings } from "../db/schema";
import { ApiError } from "../validation/errors";

/** The app has one owner; the table's CHECK allows only this id. */
const OWNER_ID = "owner";

type Row = typeof ownerSettings.$inferSelect;

function fromRow(row: Row): OwnerSettings {
  const defaults = defaultSettings();
  let limits = defaults.limits;
  try {
    const parsed = spendingLimitsSchema.safeParse(JSON.parse(row.limitsJson));
    if (parsed.success) limits = parsed.data;
  } catch {
    // Unreadable limits fall back to the defaults rather than failing the app.
  }
  const candidate = {
    nickname: row.nickname,
    locale: "zh-Hans",
    timezone: row.timezone,
    sessionMinutes: row.sessionMinutes,
    studyBand: row.studyBand,
    displayMode: row.displayMode,
    speechRate: row.speechRate,
    slangIntensity: row.slangIntensity,
    selfRatedListening: row.selfRatedListening,
    selfRatedSpeaking: row.selfRatedSpeaking,
    transcriptRetentionDays: row.transcriptRetentionDays,
    limits,
    onboardedAt: row.onboardedAt,
    updatedAt: row.updatedAt,
  };
  const parsed = ownerSettingsSchema.safeParse(candidate);
  // A stored value this version no longer accepts is replaced by its default.
  return parsed.success ? parsed.data : { ...defaults, onboardedAt: row.onboardedAt, updatedAt: row.updatedAt };
}

/** The saved settings, or the defaults when nothing has been saved yet. */
export async function getSettings(d1: D1Database): Promise<OwnerSettings> {
  const rows = await drizzle(d1).select().from(ownerSettings).where(eq(ownerSettings.ownerId, OWNER_ID)).limit(1);
  return rows[0] ? fromRow(rows[0]) : defaultSettings();
}

/** Applies a validated partial update and returns the full settings. */
export async function updateSettings(
  d1: D1Database,
  patch: SettingsUpdate,
  now: Date = new Date(),
): Promise<OwnerSettings> {
  const current = await getSettings(d1);
  const { onboarded, ...changes } = patch;
  const timestamp = now.toISOString();

  const next: OwnerSettings = {
    ...current,
    ...changes,
    // Marking onboarding done keeps the first completion time.
    onboardedAt: onboarded ? (current.onboardedAt ?? timestamp) : current.onboardedAt,
    updatedAt: timestamp,
  };
  // A partial update can leave the pair inconsistent (e.g. only hardUsd sent).
  if (next.limits.softUsd > next.limits.hardUsd) {
    throw new ApiError("BAD_REQUEST", "The warning amount cannot be above the stop amount.");
  }

  const set = {
    nickname: next.nickname,
    locale: next.locale,
    timezone: next.timezone,
    sessionMinutes: next.sessionMinutes,
    studyBand: next.studyBand,
    displayMode: next.displayMode,
    speechRate: next.speechRate,
    slangIntensity: next.slangIntensity,
    selfRatedListening: next.selfRatedListening,
    selfRatedSpeaking: next.selfRatedSpeaking,
    transcriptRetentionDays: next.transcriptRetentionDays,
    limitsJson: JSON.stringify(next.limits),
    onboardedAt: next.onboardedAt,
    updatedAt: timestamp,
  };
  await drizzle(d1).insert(ownerSettings).values({ ownerId: OWNER_ID, ...set }).onConflictDoUpdate({ target: ownerSettings.ownerId, set });
  return next;
}
