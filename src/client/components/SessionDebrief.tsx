import { Link } from "react-router";
import type { Debrief, DebriefWord } from "../../shared/debrief";
import { Section } from "./Section";

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} seconds`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function wordStatus(word: DebriefWord): string {
  if (word.usedByLearner) return "You used it";
  if (word.usedByTutor) return "The tutor used it; you did not";
  return "Did not come up";
}

/** What happened in a finished session. It reports use, not knowledge. */
export function SessionDebrief({ debrief }: { debrief: Debrief }) {
  const { turns } = debrief;
  const again = debrief.words.filter((w) => debrief.recommendedReviewItemIds.includes(w.itemId));

  return (
    <>
      <Section title="Session summary">
        <p>
          <span className="font-semibold">{duration(debrief.practiceSeconds)}</span> of practice, of a planned{" "}
          {debrief.plannedMinutes} minutes.
        </p>
        <p className="mt-1 text-sm text-mist">
          Practice time is the time between your actions, with any gap over three minutes counted as three. Paused
          time is left out.
        </p>
        <p className="mt-3">
          {plural(turns.total, "turn", "turns")}: {turns.typed} typed, {turns.spoken} spoken.
        </p>
        {turns.typed > 0 ? (
          <p className="mt-1 text-sm text-mist">Typed turns are writing practice. They are not counted as speaking.</p>
        ) : null}
        {turns.fallback > 0 ? (
          <p className="mt-1 text-sm text-mist">
            In {plural(turns.fallback, "turn", "turns")} the tutor's answer could not be used and a prepared reply was
            shown instead.
          </p>
        ) : null}
      </Section>

      <Section title="Corrections worth keeping">
        {debrief.corrections.length === 0 ? (
          <p className="text-mist">No corrections were recorded in this session.</p>
        ) : (
          <ul className="space-y-4">
            {debrief.corrections.map((correction) => (
              <li key={`${correction.original}→${correction.corrected}`}>
                <p lang="zh-Hans" className="text-lg">
                  <span className="text-mist">You wrote:</span> {correction.original}
                </p>
                <p lang="zh-Hans" className="text-lg">
                  <span className="text-mist">More natural:</span> <span className="font-semibold">{correction.corrected}</span>
                </p>
                {correction.noteEn ? <p className="mt-1 text-mist">{correction.noteEn}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {debrief.words.length > 0 ? (
        <Section title="Today's words">
          <ul className="border-t border-line">
            {debrief.words.map((word) => (
              <li key={word.itemId} className="flex flex-wrap items-baseline gap-x-4 border-b border-line py-3">
                <Link to={`/curriculum/item/${encodeURIComponent(word.itemId)}`} lang="zh-Hans" className="text-2xl text-cobalt underline">
                  {word.hanzi}
                </Link>
                <span className="text-mist">{word.pinyin}</span>
                <span className="ml-auto text-sm text-mist">{wordStatus(word)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-mist">
            Using a word once is not evidence that you know it, and this list does not change your HSK coverage.
          </p>
          {again.length > 0 ? (
            <p className="mt-3">
              Worth meeting again: <span lang="zh-Hans">{again.map((w) => w.hanzi).join("、")}</span>.{" "}
              <span className="text-mist">Scheduled review arrives in Phase 4 of the build plan.</span>
            </p>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
