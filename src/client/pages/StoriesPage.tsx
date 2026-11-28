/**
 * Graded stories and dialogues for extensive input (SPEC §5.10, FR-036):
 * outside the daily session, at the learner's known words, with audio cached
 * on the device, a tap-for-meaning gloss, and reading time logged.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { segment } from "../../shared/coverage";
import { defaultSettings } from "../../shared/settings";
import type { Story } from "../../shared/stories";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useAnswerStory, useFinishStory, useMe, useNewStory, useRevealStory, useStories, useStory } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { problemText } from "../speech/problems";
import { DRILL_VOICES } from "../../shared/onramp";
import { useVoice } from "../speech/useVoice";

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

const NOTE = "Written for you by the tutor model at your known words; not HSK content.";

export function StoriesPage() {
  const list = useStories();
  const create = useNewStory();
  const navigate = useNavigate();
  const start = (kind: "story" | "dialogue") => create.mutate({ kind, continueSeries: true }, { onSuccess: ({ story }) => void navigate(`/stories/${story.id}`) });
  return (
    <>
      <PageHeader zh="故事" en="Stories" summary="Extra listening and reading beyond the daily session, pitched at the words you know. The more of these, the better." />
      <Section title="Something new">
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={create.isPending} onClick={() => start("story")} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
            {create.isPending ? "Writing…" : "Next story episode"}
          </button>
          <button type="button" disabled={create.isPending} onClick={() => start("dialogue")} className="min-h-11 rounded-md border border-cobalt px-5 font-semibold text-cobalt disabled:opacity-60">
            Next dialogue
          </button>
        </div>
        <p className="mt-2 text-sm text-mist">{NOTE} Each one continues the last, like a series.</p>
        {create.isError ? (
          <p role="alert" className="mt-2 text-seal">
            {errorText(create.error)}
          </p>
        ) : null}
      </Section>
      <Section title="Your stories">
        <AsyncStatus isPending={list.isPending} error={list.error} onRetry={() => void list.refetch()} label="your stories">
          {list.data ? (
            <>
              <p className="mb-3">
                <span className="font-semibold tabular-nums">{Math.round(list.data.minutesThisWeek)}</span> minutes of story input this week,{" "}
                {Math.round(list.data.minutesTotal)} in all.
              </p>
              {list.data.stories.length === 0 ? <p className="text-mist">No stories yet.</p> : null}
              <ul className="border-t border-line">
                {list.data.stories.map((s) => (
                  <li key={s.id} className="border-b border-line">
                    <Link to={`/stories/${s.id}`} className="flex min-h-14 flex-wrap items-baseline gap-x-4 py-3 hover:bg-wash">
                      <span lang="zh-Hans" className="text-lg">
                        {s.titleZh}
                      </span>
                      <span className="text-mist">
                        {s.kind === "dialogue" ? "Dialogue" : "Story"} {s.episode} · {s.createdAt.slice(0, 10)}
                      </span>
                      <span className="ml-auto text-sm text-mist">
                        {s.coverage.total > 0 ? `${Math.round((s.coverage.known / s.coverage.total) * 100)}% known words` : ""}
                        {s.finishedAt ? ` · ${Math.round(s.minutes)} min` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </AsyncStatus>
      </Section>
    </>
  );
}

/** One line, each syllabus word a button that shows its meaning. */
function GlossedLine({ zh, glossary, onPick }: { zh: string; glossary: Story["glossary"]; onPick: (word: string) => void }) {
  const known = new Set(Object.keys(glossary));
  const tokens = segment(zh, known);
  let rest = zh;
  const parts: (string | { word: string })[] = [];
  for (const t of tokens) {
    const at = rest.indexOf(t);
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push(known.has(t) ? { word: t } : t);
    rest = rest.slice(at + t.length);
  }
  if (rest) parts.push(rest);
  return (
    <span lang="zh-Hans">
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <button key={i} type="button" onClick={() => onPick(p.word)} className="rounded px-0.5 underline decoration-line decoration-dotted underline-offset-4 hover:bg-wash">
            {p.word}
          </button>
        ),
      )}
    </span>
  );
}

function Reader({ story }: { story: Story }) {
  const me = useMe();
  const { speechRate } = me.data?.settings ?? defaultSettings();
  const speech = me.data?.providers.find((p) => p.id === "speech") ?? null;
  const speechOff = speech === null || speech.mode === "missing";
  const voice = useVoice(null, speechRate);
  const answer = useAnswerStory(story.id);
  const reveal = useRevealStory(story.id);
  const finish = useFinishStory(story.id);
  const [picked, setPicked] = useState<string | null>(null);
  const [choices, setChoices] = useState<(number | null)[]>(() => story.questions.map((_, i) => story.answers?.[i] ?? null));
  const [opened] = useState(() => Date.now());
  const [playingAll, setPlayingAll] = useState(false);
  useEffect(() => () => voice.stop(), [voice.stop]);

  const voiceFor = (speaker: "A" | "B" | null) => (speaker === "B" ? DRILL_VOICES[1] : DRILL_VOICES[0]);
  const playLine = (i: number) => {
    const line = story.lines[i];
    if (line) return voice.speakCached(`story-${story.id}-${i}`, line.zh, { voice: voiceFor(line.speaker), rate: speechRate });
    return Promise.resolve();
  };
  const playAll = async () => {
    setPlayingAll(true);
    for (let i = 0; i < story.lines.length; i++) await playLine(i);
    setPlayingAll(false);
  };
  const gloss = picked ? story.glossary[picked] : null;

  return (
    <>
      <p className="mb-2">
        <Link to="/stories" className="font-medium text-cobalt underline">
          All stories
        </Link>
      </p>
      <PageHeader zh={story.titleZh} en={story.revealed ? story.titleEn : `${story.kind === "dialogue" ? "Dialogue" : "Story"} ${story.episode}`} summary={NOTE} />
      {story.standIn ? <p className="mb-4 text-mist">Practice stand-in text, not a real story.</p> : null}
      <p className="mb-3 text-sm text-mist">
        {story.coverage.total > 0 ? `You had met ${story.coverage.known} of its ${story.coverage.total} words when it was written. ` : ""}
        Tap a word to see its meaning. Audio is kept on this device, so replaying it is free.
      </p>
      <div className="mb-4 flex flex-wrap gap-3">
        <button type="button" disabled={speechOff || playingAll} onClick={() => void playAll()} className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60">
          {playingAll ? "Playing…" : "Play it all"}
        </button>
        {playingAll ? (
          <button type="button" onClick={() => { voice.stop(); setPlayingAll(false); }} className="min-h-11 rounded-md border border-ink px-4 font-medium">
            Stop
          </button>
        ) : null}
      </div>
      <ol className="space-y-3">
        {story.lines.map((line, i) => (
          <li key={i} className="text-xl leading-relaxed">
            {line.speaker ? <span className="mr-2 text-sm text-mist">{line.speaker}</span> : null}
            <GlossedLine zh={line.zh} glossary={story.glossary} onPick={setPicked} />
            <button type="button" disabled={speechOff} onClick={() => void playLine(i)} aria-label={`Play line ${i + 1}`} className="ml-2 min-h-11 min-w-11 rounded-md border border-line px-2 text-base text-cobalt disabled:opacity-60">
              ▶
            </button>
            {story.revealed ? (
              <span className="block text-base text-mist">
                {line.pinyin} — {line.en}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {gloss && picked ? (
        <div role="status" className="mt-3 border-l-4 border-cobalt bg-wash px-4 py-3">
          <p>
            <span lang="zh-Hans" className="text-xl">
              {picked}
            </span>{" "}
            <span className="text-mist">{gloss.pinyin}</span>
          </p>
          <p>{gloss.definition ?? "No meaning imported yet."}</p>
          {gloss.provenance ? <p className="text-xs text-mist">{gloss.provenance}</p> : null}
        </div>
      ) : null}
      {voice.state.problem ? (
        <p role="alert" className="mt-2 text-seal">
          {problemText(voice.state.problem)}
        </p>
      ) : null}

      <Section title="Questions">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (choices.every((c) => c !== null)) answer.mutate(choices as number[]);
          }}
          className="space-y-3"
        >
          {story.questions.map((q, qi) => (
            <fieldset key={qi}>
              <legend className="font-medium">{q.questionEn}</legend>
              {q.optionsEn.map((o, oi) => (
                <label key={oi} className="flex min-h-11 items-center gap-2">
                  <input type="radio" name={`sq-${qi}`} checked={choices[qi] === oi} disabled={story.answers !== null} onChange={() => setChoices((c) => c.map((x, j) => (j === qi ? oi : x)))} />
                  <span>
                    {o}
                    {story.answers !== null && q.answerIndex === oi ? " ✓ right answer" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          {story.answers === null ? (
            <button type="submit" disabled={answer.isPending || choices.some((c) => c === null)} className="min-h-11 rounded-md bg-cobalt px-5 font-semibold text-glaze disabled:opacity-60">
              Check answers
            </button>
          ) : (
            <p role="status">
              {story.correct} of {story.questions.length} right{story.unassisted ? ", before the translation." : ", after the translation."}
            </p>
          )}
        </form>
        <div className="mt-4 flex flex-wrap gap-3">
          {!story.revealed ? (
            <button type="button" onClick={() => reveal.mutate()} className="min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt">
              Show pinyin and translation
            </button>
          ) : null}
          <button
            type="button"
            disabled={finish.isPending}
            onClick={() => finish.mutate(Math.min(60, Math.round(((Date.now() - opened) / 60_000) * 10) / 10))}
            className="min-h-11 rounded-md bg-ink px-4 font-semibold text-glaze disabled:opacity-60"
          >
            Done: log my time
          </button>
        </div>
        {finish.isSuccess ? <p role="status" className="mt-2">Logged. {Math.round(finish.data.story.minutes)} minutes on this story so far.</p> : null}
      </Section>
    </>
  );
}

export function StoryPage() {
  const { storyId = "" } = useParams();
  const story = useStory(storyId);
  return (
    <AsyncStatus isPending={story.isPending} error={story.error} onRetry={() => void story.refetch()} label="this story">
      {story.data ? <Reader key={story.data.story.id} story={story.data.story} /> : null}
    </AsyncStatus>
  );
}
