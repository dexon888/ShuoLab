/**
 * Shadowing (SPEC §7.3, FR-039): hear a line, say it straight after, and see
 * which characters Azure's pronunciation assessment found weakest. Scores are
 * a pronunciation signal against a standard Mandarin model, not a tone grade
 * and not an HSK result. The learner's own recording stays in this page.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { DRILL_VOICES } from "../../shared/onramp";
import { weakest, type AssessedWord, type AssessmentScores } from "../../shared/pronunciation";
import { defaultSettings } from "../../shared/settings";
import { useMe, useRecordPronunciation } from "../hooks/queries";
import { problemText } from "../speech/problems";
import { useVoice } from "../speech/useVoice";

interface Result {
  scores: AssessmentScores;
  words: AssessedWord[];
  /** Object URL of the learner's own attempt, in memory only. */
  mine: string | null;
}

export const SCORE_NOTE = "Scored by Azure pronunciation assessment against a standard Mandarin model: a guide for practice, not a tone grade or an HSK result.";

function band(accuracy: number): string {
  if (accuracy >= 80) return "clear";
  if (accuracy >= 60) return "unclear";
  return "weak";
}

/** The line, each character marked by how clearly it came across. */
function MarkedLine({ words }: { words: AssessedWord[] }) {
  return (
    <p lang="zh-Hans" className="text-2xl leading-relaxed">
      {words.map((w, i) => {
        const b = band(w.accuracy);
        return (
          <span
            key={i}
            title={`${w.text}: ${Math.round(w.accuracy)}`}
            className={b === "weak" ? "underline decoration-seal decoration-4 underline-offset-8" : b === "unclear" ? "underline decoration-mist decoration-2 decoration-dashed underline-offset-8" : ""}
          >
            {w.text}
            {b !== "clear" ? <span className="sr-only"> ({b}, {Math.round(w.accuracy)})</span> : null}
          </span>
        );
      })}
    </p>
  );
}

export function ShadowPanel({ sessionId, lines }: { sessionId: string | null; lines: readonly string[] }) {
  const me = useMe();
  const { speechRate } = me.data?.settings ?? defaultSettings();
  const speech = me.data?.providers.find((p) => p.id === "speech") ?? null;
  const voice = useVoice(sessionId, speechRate);
  const record = useRecordPronunciation();
  const [active, setActive] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, Result>>({});
  const [keepCopy, setKeepCopy] = useState(true);
  const urls = useRef<string[]>([]);
  const playing = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      voice.stop();
      playing.current?.pause();
      for (const u of urls.current) URL.revokeObjectURL(u);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (lines.length === 0) return null;
  if (speech === null || speech.mode === "missing") {
    return <p className="text-mist">Shadowing needs the speech service, which is not set up.</p>;
  }
  if (!voice.canRecord) {
    return <p className="text-mist">Shadowing needs a microphone on a secure (https) page.</p>;
  }

  const hear = (i: number) => void voice.speakCached(`shadow-${sessionId ?? "free"}-${i}`, lines[i] ?? "", { voice: DRILL_VOICES[0], rate: speechRate });
  const shadow = async (i: number) => {
    const text = lines[i];
    if (!text) return;
    setActive(i);
    const outcome = await voice.assess(text, { keepCopy });
    setActive(null);
    if (!outcome) return;
    let mine: string | null = null;
    if (outcome.mine) {
      mine = URL.createObjectURL(outcome.mine);
      urls.current.push(mine);
    }
    setResults((r) => ({ ...r, [i]: { scores: outcome.scores, words: outcome.words, mine } }));
    // Scores only; the recording never leaves this page.
    record.mutate({ sessionId, referenceText: text, scores: outcome.scores, words: outcome.words.slice(0, 60), audioSeconds: Math.min(60, outcome.audioSeconds) });
  };
  const playMine = (url: string) => {
    playing.current?.pause();
    const audio = new Audio(url);
    playing.current = audio;
    void audio.play().catch(() => undefined);
  };
  const busy = voice.state.phase !== "idle";

  return (
    <div className="space-y-4">
      <p>Play a line, then say it straight after in the same rhythm. The characters that came across least clearly are underlined.</p>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} className="size-5" />
        Keep my attempt on this page to compare (never uploaded)
      </label>
      <ol className="space-y-4">
        {lines.map((line, i) => {
          const r = results[i];
          const weak = r ? weakest(r.words) : [];
          return (
            <li key={i} className="border-l-4 border-line pl-3">
              {r ? <MarkedLine words={r.words} /> : <p lang="zh-Hans" className="text-2xl leading-relaxed">{line}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => hear(i)} className="min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt disabled:opacity-60">
                  Play line {i + 1}
                </button>
                <button type="button" disabled={busy} onClick={() => void shadow(i)} className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60">
                  {active === i && voice.state.phase === "listening" ? "Listening… say it now" : r ? `Shadow line ${i + 1} again` : `Shadow line ${i + 1}`}
                </button>
                {r?.mine ? (
                  <button type="button" onClick={() => playMine(r.mine as string)} className="min-h-11 rounded-md border border-ink px-4 font-medium">
                    Play my attempt
                  </button>
                ) : null}
              </div>
              {r ? (
                <div className="mt-2" role="status">
                  <p>
                    Pronunciation <span className="font-semibold tabular-nums">{Math.round(r.scores.pronunciation)}</span> · accuracy {Math.round(r.scores.accuracy)} · fluency {Math.round(r.scores.fluency)} · completeness{" "}
                    {Math.round(r.scores.completeness)} (out of 100)
                  </p>
                  {weak.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-sm font-medium">Weakest</p>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {weak.map((w) => (
                          <li key={w.text}>
                            <button type="button" disabled={busy} onClick={() => void voice.speakText(`shadow-char-${w.text}`, w.text, { rate: Math.min(speechRate, 0.8) })} className="min-h-11 rounded-md border border-line px-3 hover:bg-wash disabled:opacity-60">
                              Hear <span lang="zh-Hans" className="text-lg">{w.text}</span> <span className="text-sm text-mist">({Math.round(w.accuracy)})</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-sm">
                        Tones the trouble?{" "}
                        <Link to="/start/tone-pairs" className="font-medium text-cobalt underline">
                          Drill tone pairs
                        </Link>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-mist">Every character came across clearly.</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {voice.state.problem ? (
        <p role="alert" className="text-seal">
          {problemText(voice.state.problem)}
        </p>
      ) : null}
      <p className="text-sm text-mist">{SCORE_NOTE}</p>
    </div>
  );
}
