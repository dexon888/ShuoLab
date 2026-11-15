import { useId, useState, type FormEvent, type ReactNode } from "react";
import { HSK_BANDS, isHskBand } from "../../shared/curriculum";
import { SESSION_MINUTE_OPTIONS } from "../../shared/learning";
import {
  DISPLAY_MODES,
  DISPLAY_MODE_LABELS,
  LIMIT_USD_MAX,
  SELF_RATINGS,
  SELF_RATING_LABELS,
  SLANG_INTENSITIES,
  SLANG_INTENSITY_LABELS,
  SPEECH_RATE_MAX,
  SPEECH_RATE_MIN,
  SPEECH_RATE_STEP,
  isValidTimeZone,
  type OwnerSettings,
  type SettingsUpdate,
} from "../../shared/settings";
import { useUpdateSettings } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";

const FIELD = "min-h-11 w-full rounded-md border border-mist bg-glaze px-3";

function detectedTimeZone(): string | null {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

function supportedTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

function timeZoneOptions(selected: string): string[] {
  const all = new Set(["UTC", ...supportedTimeZones(), selected]);
  return [...all].sort((a, b) => a.localeCompare(b));
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (ids: { id: string; hintId?: string }) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
      </label>
      {children({ id, hintId: hint ? hintId : undefined })}
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-mist">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function pickOne<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

interface PreferencesFormProps {
  settings: OwnerSettings;
  /** Onboarding marks setup as finished and leaves out the spending limits. */
  mode: "onboarding" | "settings";
  onSaved?: () => void;
}

export function PreferencesForm({ settings, mode, onSaved }: PreferencesFormProps) {
  const update = useUpdateSettings();
  const [rate, setRate] = useState(settings.speechRate);
  const [problem, setProblem] = useState<string | null>(null);
  const minutesName = useId();

  // Before anything is saved, start from this device's time zone.
  const initialZone = settings.updatedAt === null ? (detectedTimeZone() ?? settings.timezone) : settings.timezone;
  const deviceZone = detectedTimeZone();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nickname = String(form.get("nickname") ?? "").trim();
    const band = form.get("studyBand");
    const minutes = Number(form.get(minutesName));

    const patch: SettingsUpdate = {
      nickname: nickname === "" ? null : nickname,
      selfRatedListening: pickOne(form.get("selfRatedListening"), SELF_RATINGS),
      selfRatedSpeaking: pickOne(form.get("selfRatedSpeaking"), SELF_RATINGS),
      studyBand: isHskBand(band) ? band : null,
      sessionMinutes: SESSION_MINUTE_OPTIONS.find((m) => m === minutes) ?? settings.sessionMinutes,
      displayMode: pickOne(form.get("displayMode"), DISPLAY_MODES) ?? settings.displayMode,
      speechRate: rate,
      slangIntensity: pickOne(form.get("slangIntensity"), SLANG_INTENSITIES) ?? settings.slangIntensity,
      timezone: String(form.get("timezone") ?? settings.timezone),
    };

    if (mode === "settings") {
      const softUsd = Number(form.get("softUsd"));
      const hardUsd = Number(form.get("hardUsd"));
      if (!Number.isFinite(softUsd) || !Number.isFinite(hardUsd) || softUsd < 0 || hardUsd < 0) {
        setProblem("Enter the spending limits as amounts in US dollars.");
        return;
      }
      if (softUsd > hardUsd) {
        setProblem("The warning amount cannot be above the stop amount.");
        return;
      }
      patch.limits = { softUsd, hardUsd };
    } else {
      patch.onboarded = true;
    }

    setProblem(null);
    update.mutate(patch, { onSuccess: () => onSaved?.() });
  };

  const error =
    problem ??
    (update.error
      ? update.error instanceof ApiRequestError
        ? update.error.message
        : "Something went wrong. Try again."
      : null);

  return (
    <form onSubmit={submit} onChange={() => update.isSuccess && update.reset()} className="space-y-8" noValidate>
      <fieldset className="space-y-5">
        <legend className="mb-3 text-xl font-semibold text-cobalt-deep">About you</legend>
        <Field label="Nickname (optional)" hint="What the tutor calls you.">
          {({ id, hintId }) => (
            <input id={id} name="nickname" type="text" defaultValue={settings.nickname ?? ""} maxLength={40} autoComplete="nickname" aria-describedby={hintId} className={FIELD} />
          )}
        </Field>
        <Field label="How much spoken Mandarin do you understand?" hint="Your own estimate. It is not treated as a measured level.">
          {({ id, hintId }) => (
            <select id={id} name="selfRatedListening" defaultValue={settings.selfRatedListening ?? ""} aria-describedby={hintId} className={FIELD}>
              <option value="">Prefer not to say</option>
              {SELF_RATINGS.map((r) => (
                <option key={r} value={r}>
                  {SELF_RATING_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="How much can you say?">
          {({ id }) => (
            <select id={id} name="selfRatedSpeaking" defaultValue={settings.selfRatedSpeaking ?? ""} className={FIELD}>
              <option value="">Prefer not to say</option>
              {SELF_RATINGS.map((r) => (
                <option key={r} value={r}>
                  {SELF_RATING_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="HSK band to study"
          hint="A study target you choose, not a proven level. If you leave it unset, sessions start from HSK 1 as a suggestion."
        >
          {({ id, hintId }) => (
            <select id={id} name="studyBand" defaultValue={settings.studyBand ?? ""} aria-describedby={hintId} className={FIELD}>
              <option value="">Not chosen</option>
              {HSK_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band === "7-9" ? "HSK 7–9 (shared band)" : `HSK ${band}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="mb-3 text-xl font-semibold text-cobalt-deep">Sessions</legend>
        <div role="radiogroup" aria-label="Daily session length">
          <p className="mb-1 font-medium">Daily session length</p>
          <div className="flex flex-wrap gap-2">
            {SESSION_MINUTE_OPTIONS.map((minutes) => (
              <label key={minutes} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-mist bg-glaze px-4 has-checked:border-cobalt has-checked:bg-wash">
                <input type="radio" name={minutesName} value={minutes} defaultChecked={settings.sessionMinutes === minutes} />
                {minutes} minutes
              </label>
            ))}
          </div>
        </div>
        <Field label="Reading help" hint="What is shown with Chinese text. You can always reveal more during a session.">
          {({ id, hintId }) => (
            <select id={id} name="displayMode" defaultValue={settings.displayMode} aria-describedby={hintId} className={FIELD}>
              {DISPLAY_MODES.map((mode_) => (
                <option key={mode_} value={mode_}>
                  {DISPLAY_MODE_LABELS[mode_]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Speech rate" hint="1.00× is natural speed. Applies to spoken audio once speech is built.">
          {({ id, hintId }) => (
            <div className="flex items-center gap-4">
              <input
                id={id}
                type="range"
                min={SPEECH_RATE_MIN}
                max={SPEECH_RATE_MAX}
                step={SPEECH_RATE_STEP}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                aria-describedby={hintId}
                aria-valuetext={`${rate.toFixed(2)} times natural speed`}
                className="min-h-11 flex-1"
              />
              <output htmlFor={id} className="w-14 text-right font-medium tabular-nums">
                {rate.toFixed(2)}×
              </output>
            </div>
          )}
        </Field>
        <Field label="Colloquial language" hint="Slang is always labelled with who it suits, and is never counted as HSK content.">
          {({ id, hintId }) => (
            <select id={id} name="slangIntensity" defaultValue={settings.slangIntensity} aria-describedby={hintId} className={FIELD}>
              {SLANG_INTENSITIES.map((level) => (
                <option key={level} value={level}>
                  {SLANG_INTENSITY_LABELS[level]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Time zone"
          hint={deviceZone ? `Decides when your study day starts. This device is set to ${deviceZone}.` : "Decides when your study day starts."}
        >
          {({ id, hintId }) => (
            <select id={id} name="timezone" defaultValue={initialZone} aria-describedby={hintId} className={FIELD}>
              {timeZoneOptions(initialZone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      {mode === "settings" ? (
        <fieldset className="space-y-5">
          <legend className="mb-3 text-xl font-semibold text-cobalt-deep">Monthly spending limits</legend>
          <p className="text-mist">
            ShuoLab's own estimate of tutor costs, in US dollars. When the month's estimate
            reaches the stop amount, paid tutor requests are refused. They are not a cap at OpenAI
            or Azure, so set limits in those accounts too.
          </p>
          <Field label="Warn me at (US$)">
            {({ id }) => (
              <input id={id} name="softUsd" type="number" inputMode="decimal" min={0} max={LIMIT_USD_MAX} step="0.01" defaultValue={settings.limits.softUsd} className={FIELD} />
            )}
          </Field>
          <Field label="Stop paid requests at (US$)">
            {({ id }) => (
              <input id={id} name="hardUsd" type="number" inputMode="decimal" min={0} max={LIMIT_USD_MAX} step="0.01" defaultValue={settings.limits.hardUsd} className={FIELD} />
            )}
          </Field>
        </fieldset>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={update.isPending}
          className="min-h-12 w-full rounded-md bg-cobalt px-6 text-lg font-semibold text-glaze hover:bg-cobalt-deep disabled:opacity-60 sm:w-auto"
        >
          {update.isPending ? "Saving…" : mode === "onboarding" ? "Save and continue" : "Save settings"}
        </button>
        {error ? (
          <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
            Not saved. {error}
          </p>
        ) : null}
        {update.isSuccess && !error ? (
          <p role="status" className="mt-3 text-jade">
            Saved. These settings apply on every device you sign in on.
          </p>
        ) : null}
      </div>
    </form>
  );
}
