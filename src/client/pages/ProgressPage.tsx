import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { SKILLS, type Skill } from "../../shared/learning";
import { MIN_OBSERVATIONS, PROGRESS_WINDOWS, type ProgressSummary, type ProgressWindow } from "../../shared/progress";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { PracticeChart } from "../components/PracticeChart";
import { Section } from "../components/Section";
import { useProgressSummary } from "../hooks/queries";

const SKILL_LABELS: Readonly<Record<Skill, string>> = { listening: "Listening", speaking: "Speaking", reading: "Reading", writing: "Writing" };

function bandName(band: string): string {
  return band === "7-9" ? "HSK 7–9" : `HSK ${band}`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A headline figure with what it is drawn from, or why there is none yet. */
function Figure({ label, value, basis }: { label: string; value: ReactNode; basis: ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="text-sm text-mist">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-mist">{basis}</p>
    </div>
  );
}

function insufficient(n: number, unit: string, many: string): string {
  return `Insufficient evidence: ${plural(n, unit, many)} of the ${MIN_OBSERVATIONS} needed.`;
}

function Summary({ s }: { s: ProgressSummary }) {
  const { practice, listening, speaking, reviews, hsk } = s;
  return (
    <>
      <Section title="Practice time">
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Figure label="Minutes practised" value={practice.totalMinutes} basis={`${s.window.from} to ${s.window.to}`} />
          <Figure label="Days with practice" value={practice.activeDays} basis={`of ${s.window.days}`} />
          <Figure label="Sessions finished" value={practice.sessionsCompleted} basis="Time is counted between your actions; pauses are left out." />
        </div>
        <PracticeChart days={practice.days} />
      </Section>

      <Section title="Communication">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure
            label="Listening accuracy"
            value={listening.accuracy === null ? "—" : percent(listening.accuracy)}
            basis={
              listening.accuracy === null
                ? insufficient(listening.checks, "listening check", "listening checks")
                : `${listening.correct} of ${listening.questions} questions right in ${plural(listening.checks, "check", "checks")}, answered before seeing the text.`
            }
          />
          <Figure
            label="Spoken turns"
            value={speaking.spokenTurns}
            basis={`In ${plural(speaking.sessionsWithSpeech, "session", "sessions")}. ${plural(speaking.typedTurns, "typed turn", "typed turns")}, counted as writing, not speaking.`}
          />
          <Figure
            label="Review recall"
            value={reviews.recallRate === null ? "—" : percent(reviews.recallRate)}
            basis={
              reviews.recallRate === null
                ? insufficient(reviews.ratings, "rating", "ratings")
                : `${reviews.recalled} of ${reviews.ratings} reviews recalled, by your own rating; average ${reviews.averageRating?.toFixed(1)} of 4.`
            }
          />
        </div>
        {listening.assistedChecks > 0 ? (
          <p className="mt-3 text-sm text-mist">
            {plural(listening.assistedChecks, "listening check was", "listening checks were")} answered after the text was
            shown and {listening.assistedChecks === 1 ? "is" : "are"} left out.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-mist">
          Listening checks are exchanges written for your sessions, not standard tests. Speech recognition is not a
          pronunciation score. None of this is an HSK result.
        </p>
      </Section>

      <Section title="HSK vocabulary coverage">
        {hsk.editionId === null ? (
          <p>
            No vocabulary is imported, so there is nothing to measure against.{" "}
            <Link to="/curriculum" className="font-medium text-cobalt underline">
              See the curriculum
            </Link>
          </p>
        ) : (
          <>
            <p className="mb-3 text-mist">
              Edition {hsk.editionId}.{" "}
              {hsk.synthetic ? "Generated placeholder words for testing, not HSK content. " : null}
              Each band counts its own new entries; mastered means recalled on three different days by this app's rule.
            </p>
            {/* A table that scrolls sideways must be reachable by keyboard (axe scrollable-region-focusable). */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Entries per band by evidence state, scrolls sideways">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Entries per band by evidence state</caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-3 font-medium">Band</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Entries</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Met</th>
                    {SKILLS.map((skill) => (
                      <th key={skill} scope="col" className="py-2 pr-3 text-right font-medium">
                        {SKILL_LABELS[skill]}
                        <span className="block text-xs font-normal text-mist">mastered · developing</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...hsk.bands.map((b) => ({ ...b, label: bandName(b.band) })), { ...hsk.total, label: "All bands", band: "all", expectedEntries: 0 }].map((row) => (
                    <tr key={row.band} className={`border-b border-line ${row.band === "all" ? "font-semibold" : ""}`}>
                      <th scope="row" className="py-2 pr-3 text-left font-medium">{row.label}</th>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.entries}
                        {row.band !== "all" && row.entries < row.expectedEntries ? (
                          <span className="block text-xs font-normal text-seal">of {row.expectedEntries} published</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.introduced}</td>
                      {SKILLS.map((skill) => (
                        <td key={skill} className="py-2 pr-3 text-right tabular-nums">
                          {row.bySkill[skill].mastered} · {row.bySkill[skill].developing}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-mist">
              Met: entries a finished session targeted, or that you have reviewed. Meeting a word is not knowing it.
              Speaking and writing move only with speaking and writing practice, which a word gets after its first
              recall. Coverage is not a prediction of an HSK exam result.
            </p>
          </>
        )}
      </Section>

      <SectionsProgress s={s} />

      <Section title="Skill balance">
        <p className="mb-2">
          <span className="font-semibold tabular-nums">{s.meaningfulDays.count}</span> meaningful{" "}
          {s.meaningfulDays.count === 1 ? "day" : "days"} in the last {s.window.days}: days on which you both produced
          something (spoke or wrote) and recalled something in review.
        </p>
        <ul className="space-y-1">
          {s.skillBalance.map((b) => (
            <li key={b.skill}>
              {SKILL_LABELS[b.skill]}: <span className="tabular-nums">{b.attempts}</span> {b.attempts === 1 ? "attempt" : "attempts"}
              {b.attempts > 0 ? `, ${b.successes} successful` : ""}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-mist">Attempts are review ratings, guided practice, writing and grammar used in conversation. Typed answers count as writing.</p>
      </Section>
    </>
  );
}

/** Grammar and characters against their imported rows, and topics and tasks as exposure (SPEC §2.5, §8.3). */
function SectionsProgress({ s }: { s: ProgressSummary }) {
  const { grammar, character, topics, tasks } = s.sections;
  if (!grammar && !character && topics.imported === 0 && tasks.imported === 0) return null;
  const rows = [
    { name: "Grammar points", data: grammar },
    { name: "Characters", data: character },
  ].filter((r): r is { name: string; data: NonNullable<typeof grammar> } => r.data !== null);
  return (
    <Section title="Grammar, characters, topics and tasks">
      {rows.some((r) => r.data.unverified) ? (
        <p className="mb-3 text-mist">
          From a second-hand transcription of the syllabus, not checked against the official document. Counted against
          the imported rows, kept apart from verified vocabulary coverage, and never an HSK score.
        </p>
      ) : null}
      <ul className="space-y-3">
        {rows.map(({ name, data }) => (
          <li key={name}>
            <span className="font-medium">{name}:</span> met <span className="tabular-nums">{data.total.introduced}</span> of{" "}
            <span className="tabular-nums">{data.total.entries}</span>. Mastered:{" "}
            {SKILLS.filter((k) => data.total.bySkill[k].mastered + data.total.bySkill[k].developing > 0 || k === "reading")
              .map((k) => `${SKILL_LABELS[k].toLowerCase()} ${data.total.bySkill[k].mastered} (developing ${data.total.bySkill[k].developing})`)
              .join(", ")}
            .
          </li>
        ))}
        <li>
          <span className="font-medium">Topics:</span> {topics.met} of {topics.imported} used in a finished session.
        </li>
        <li>
          <span className="font-medium">Tasks:</span> {tasks.met} of {tasks.imported} practised, {tasks.achieved} achieved by the task
          check (passed on two days, in two topics). Practising a task is not achieving it.
        </li>
      </ul>
    </Section>
  );
}

export function ProgressPage() {
  const [days, setDays] = useState<ProgressWindow>(30);
  const progress = useProgressSummary(days);

  return (
    <>
      <PageHeader zh="进度" en="Progress" />
      <div role="group" aria-label="Period" className="mb-6 flex flex-wrap gap-2">
        {PROGRESS_WINDOWS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={`min-h-11 rounded-md border px-4 font-medium ${days === d ? "border-cobalt bg-cobalt text-glaze" : "border-line text-ink"}`}
          >
            {d} days
          </button>
        ))}
      </div>
      <AsyncStatus isPending={progress.isPending} error={progress.error} onRetry={() => void progress.refetch()} label="your progress">
        {progress.data ? <Summary s={progress.data} /> : null}
      </AsyncStatus>
    </>
  );
}
