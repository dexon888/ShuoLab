import { useState } from "react";
import { Link } from "react-router";
import { SLOWER_RATE_FACTOR } from "../../shared/listening";
import type { MasteryState } from "../../shared/learning";
import { grammarMarkers, usesGrammar } from "../../shared/lesson";
import { REVIEW_RATINGS, type ReviewCard, type ReviewRating } from "../../shared/review";
import { defaultSettings } from "../../shared/settings";
import { AsyncStatus } from "../components/AsyncStatus";
import { PageHeader } from "../components/PageHeader";
import { useDueReviews, useMe, useRateCard } from "../hooks/queries";
import { ApiRequestError } from "../lib/api";
import { problemText } from "../speech/problems";
import { useVoice } from "../speech/useVoice";

const RATING_LABELS: Readonly<Record<ReviewRating, string>> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

const RATING_HINTS: Readonly<Record<ReviewRating, string>> = {
  again: "didn't recall it",
  hard: "recalled it with effort",
  good: "recalled it",
  easy: "recalled it at once",
};

const MASTERY_LABELS: Readonly<Record<MasteryState, string>> = {
  unseen: "not seen yet",
  introduced: "introduced, not yet recalled",
  practiced: "practised, not yet recalled",
  developing: "developing",
  mastered: "mastered by this app's rule",
};

const PROMPTS: Readonly<Record<ReviewCard["template"], { skill: string; ask: string }>> = {
  hanzi_to_meaning: { skill: "Reading", ask: "How is this said, and what does it mean?" },
  audio_to_meaning: { skill: "Listening", ask: "Which word is this, and what does it mean?" },
  word_say: { skill: "Speaking", ask: "Say a short sentence aloud that uses this word." },
  word_write: { skill: "Writing (typed)", ask: "Listen, then type the word in characters." },
  grammar_read: { skill: "Reading", ask: "Read the example. What does the pattern do here?" },
  grammar_listen: { skill: "Listening", ask: "Listen to the example. What does it say?" },
  grammar_say: { skill: "Speaking", ask: "Say a sentence of your own aloud that uses this pattern." },
  grammar_write: { skill: "Writing (typed)", ask: "Type a sentence of your own that uses this pattern." },
  char_recognise: { skill: "Reading", ask: "Which words do you know this character from, and how is it read?" },
  char_type: { skill: "Writing (typed)", ask: "Type the missing character." },
};

/** The text a card plays: the example for grammar, the word otherwise. */
function spokenText(card: ReviewCard): string {
  return card.template === "grammar_listen" ? (card.item.example ?? card.item.hanzi) : card.item.hanzi;
}

/** The word a typing card is built on, with the character blanked out. */
function blankedWord(card: ReviewCard): { shown: string; pinyin: string | null } | null {
  const word = card.item.words[0];
  if (!word) return null;
  return { shown: word.hanzi.split(card.item.hanzi).join("＿"), pinyin: word.pinyin };
}

/** Checks a typed answer the same way for every writing card. Null when nothing can be checked. */
export function checkTyped(card: ReviewCard, answer: string): boolean | null {
  const a = answer.trim();
  if (!a) return null;
  if (card.template === "word_write" || card.template === "char_type") return a === card.item.hanzi;
  if (card.template === "grammar_write") return usesGrammar(a, grammarMarkers(card.item.hanzi));
  return null;
}

/** "in 10 min", "in 3 days": how far away a due time is. */
export function untilText(iso: string, now: Date): string {
  const minutes = Math.max(1, Math.round((Date.parse(iso) - now.getTime()) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

function errorText(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.";
}

export function CardView({ card, onDone, onSkip }: { card: ReviewCard; onDone: () => void; onSkip: () => void }) {
  const me = useMe();
  const { speechRate } = me.data?.settings ?? defaultSettings();
  const speech = me.data?.providers.find((p) => p.id === "speech") ?? null;
  const speechOff = speech === null || speech.mode === "missing";
  const voice = useVoice(null, speechRate);
  const rate = useRateCard();
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  // One id per card shown, reused if the same rating is sent again.
  const [eventId] = useState(() => crypto.randomUUID());
  const listening = card.template === "audio_to_meaning" || card.template === "grammar_listen" || card.template === "word_write";
  const typing = card.template === "word_write" || card.template === "grammar_write" || card.template === "char_type";
  const verdict = shown && typing ? checkTyped(card, typed) : null;
  const blank = card.template === "char_type" ? blankedWord(card) : null;
  const prompt = PROMPTS[card.template];
  const playing = voice.state.phase === "starting" || voice.state.phase === "speaking";
  const now = new Date();

  const play = (slower: boolean) => void voice.speakText(card.id, spokenText(card), { rate: slower ? speechRate * SLOWER_RATE_FACTOR : speechRate });
  const send = (rating: ReviewRating) => {
    voice.stop();
    rate.mutate({ cardId: card.id, rating, clientEventId: eventId, ...(typing && typed.trim() ? { answer: typed.trim() } : {}) }, { onSuccess: onDone });
  };
  const kind = card.item.itemType === "grammar" ? "grammar point" : card.item.itemType === "character" ? "character" : "word";

  return (
    <article aria-label="Review card" className="border-t border-line pt-6">
      <p className="text-sm font-semibold text-cobalt-deep">{prompt.skill}</p>
      <p className="mt-1">{prompt.ask}</p>
      {card.item.synthetic ? (
        <p className="mt-2 text-sm text-mist">Generated placeholder {kind === "word" ? "word" : "data"} for testing. Not HSK content.</p>
      ) : null}
      {card.item.unverified ? (
        <p className="mt-2 text-sm text-mist">From a second-hand transcription of the syllabus, not checked against the official document.</p>
      ) : null}

      <div className="my-6 min-h-24">
        {listening && !shown ? (
          <div className="flex flex-wrap gap-3">
            {playing ? (
              <button type="button" onClick={voice.stop} className="min-h-11 rounded-md border border-ink px-4 font-medium">
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={speechOff}
                  onClick={() => play(false)}
                  className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze disabled:opacity-60"
                >
                  Play the word
                </button>
                <button
                  type="button"
                  disabled={speechOff}
                  onClick={() => play(true)}
                  className="min-h-11 rounded-md border border-cobalt px-4 font-medium text-cobalt disabled:opacity-60"
                >
                  Play slower
                </button>
              </>
            )}
            {speechOff ? (
              <p className="w-full text-mist">Speech is not set up, so this card can't be played. Skip it for now.</p>
            ) : speech?.mode === "mock" ? (
              <p className="w-full text-mist">Practice stand-in speech: Play makes no sound.</p>
            ) : null}
          </div>
        ) : card.template === "grammar_read" ? (
          <p lang="zh-Hans" className="text-3xl leading-snug">
            {card.item.example ?? card.item.hanzi}
          </p>
        ) : card.template === "grammar_say" || card.template === "grammar_write" ? (
          <p lang="zh-Hans" className="text-4xl">
            {card.item.hanzi}
          </p>
        ) : card.template === "char_type" ? (
          <p lang="zh-Hans" className="text-4xl">
            {blank ? blank.shown : "＿"}
            {blank?.pinyin ? <span className="ml-3 text-xl text-mist">{blank.pinyin}</span> : null}
          </p>
        ) : card.template === "word_say" ? (
          <p lang="zh-Hans" className="text-5xl">
            {card.item.hanzi}
            {card.item.pinyin ? <span className="ml-3 text-xl text-mist">{card.item.pinyin}</span> : null}
          </p>
        ) : card.template === "grammar_listen" || card.template === "word_write" ? (
          <p lang="zh-Hans" className="text-4xl">
            {card.template === "grammar_listen" ? card.item.example : card.item.hanzi}
          </p>
        ) : (
          <p lang="zh-Hans" className="font-kai text-5xl">
            {card.item.hanzi}
          </p>
        )}
        {typing && !shown ? (
          <div className="mt-4">
            <label htmlFor={`typed-${card.id}`} className="mb-1 block font-medium">
              Your answer
            </label>
            <input
              id={`typed-${card.id}`}
              lang="zh-Hans"
              value={typed}
              maxLength={300}
              onChange={(e) => setTyped(e.target.value)}
              className="min-h-11 w-full rounded-md border border-mist bg-glaze px-3 text-xl"
            />
            <p className="mt-1 text-sm text-mist">Typed with a pinyin keyboard, so this practises producing it, not handwriting.</p>
          </div>
        ) : null}
        {voice.state.problem ? (
          <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
            {problemText(voice.state.problem)}
          </p>
        ) : null}
      </div>

      {shown && verdict !== null ? (
        <p role="status" className="mb-3 font-medium">
          {verdict ? "✓ That matches." : card.template === "grammar_write" ? "✗ The pattern isn't in your sentence." : "✗ Not quite."} Rate how well you produced it.
        </p>
      ) : null}
      {shown && card.item.itemType !== "vocab" ? (
        <div className="border-l-4 border-cobalt bg-wash px-4 py-3">
          {card.item.itemType === "grammar" ? (
            <>
              <p lang="zh-Hans" className="text-xl font-semibold">
                {card.item.hanzi}
                {card.item.details?.kind === "grammar" ? <span className="ml-2 text-base font-normal text-mist">{card.item.details.grammarType}</span> : null}
              </p>
              {card.item.example ? (
                <p lang="zh-Hans" className="mt-1 text-lg">
                  Example: {card.item.example}
                </p>
              ) : null}
              {typed.trim() ? (
                <p lang="zh-Hans" className="mt-1">
                  You: {typed.trim()}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p lang="zh-Hans" className="font-kai text-4xl">
                {card.item.hanzi}
              </p>
              {card.item.words.length > 0 ? (
                <ul className="mt-2">
                  {card.item.words.map((w) => (
                    <li key={w.hanzi} lang="zh-Hans" className="text-lg">
                      {w.hanzi} <span className="text-mist">{w.pinyin}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-mist">No word you have met contains it yet.</p>
              )}
            </>
          )}
          <p className="mt-2 text-sm">
            <Link to={`/curriculum/item/${encodeURIComponent(card.item.id)}`} className="font-medium text-cobalt underline">
              Open the entry
            </Link>
          </p>
        </div>
      ) : shown ? (
        <div className="border-l-4 border-cobalt bg-wash px-4 py-3">
          <p className="text-xl">{card.item.pinyin ?? "No pinyin recorded."}</p>
          {card.item.definition ? (
            <p className="mt-1">
              {card.item.definition}{" "}
              <span className="text-sm text-mist">Source: {card.item.definitionProvenance}</span>
            </p>
          ) : (
            <p className="mt-1 text-mist">No English definition is imported for this word. Judge by whether you knew its meaning.</p>
          )}
          <p className="mt-2 text-sm">
            <Link to={`/curriculum/item/${encodeURIComponent(card.item.id)}`} className="font-medium text-cobalt underline">
              Open the entry
            </Link>
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setShown(true)} className="min-h-11 rounded-md bg-cobalt px-4 font-semibold text-glaze">
            Show answer
          </button>
          <button type="button" onClick={onSkip} className="min-h-11 rounded-md border border-ink px-4 font-medium">
            Skip for now
          </button>
        </div>
      )}

      {shown ? (
        <fieldset className="mt-6" disabled={rate.isPending}>
          <legend className="font-medium">How well did you recall it?</legend>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {REVIEW_RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => send(rating)}
                className="min-h-14 rounded-md border border-cobalt px-3 py-2 text-left disabled:opacity-60"
              >
                <span className="block font-semibold text-cobalt-deep">{RATING_LABELS[rating]}</span>
                <span className="block text-sm text-mist">
                  {RATING_HINTS[rating]}, next {untilText(card.preview[rating], now)}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {rate.isError ? (
        <p role="alert" className="mt-3 border-l-4 border-seal bg-seal-wash px-4 py-3">
          {errorText(rate.error)}
        </p>
      ) : null}

      <p className="mt-6 text-sm text-mist">
        {prompt.skill} for this {kind}: {MASTERY_LABELS[card.mastery]}. Your rating is your own judgement; nothing is
        marked as known for you. Mastered here means recalled on three different days, at least once a day or more
        after you met the word, with the latest recall a success. That is this app's rule, not an HSK standard.
      </p>
    </article>
  );
}

function ReviewQueue() {
  const due = useDueReviews();
  const [skipped, setSkipped] = useState<string[]>([]);
  const data = due.data;
  const queue = data ? [...data.cards.filter((c) => !skipped.includes(c.id)), ...data.cards.filter((c) => skipped.includes(c.id))] : [];
  const card = queue[0];

  return (
    <AsyncStatus isPending={due.isPending} error={due.error} onRetry={() => void due.refetch()} label="your reviews">
      {data ? (
        data.totalCards === 0 ? (
          <p className="max-w-[60ch]">
            No review cards yet. When you finish a session, each word it targeted gets a reading card and a listening card
            here. Stretch words are left out.
          </p>
        ) : data.dueCount === 0 ? (
          <div>
            <p>
              Nothing is due. {data.nextDueAt ? `The next card is due ${untilText(data.nextDueAt, new Date())}.` : null}
            </p>
            <button type="button" onClick={() => void due.refetch()} className="mt-3 min-h-11 font-medium text-cobalt underline">
              Check again
            </button>
          </div>
        ) : card ? (
          <>
            <p aria-live="polite" className="mb-4 text-mist">
              {data.dueCount} due of {data.totalCards} cards.
            </p>
            <CardView
              key={card.id}
              card={card}
              onDone={() => setSkipped((s) => s.filter((id) => id !== card.id))}
              onSkip={() => setSkipped((s) => [...s.filter((id) => id !== card.id), card.id])}
            />
          </>
        ) : null
      ) : null}
    </AsyncStatus>
  );
}

export function ReviewPage() {
  return (
    <>
      <PageHeader zh="复习" en="Review" />
      <ReviewQueue />
    </>
  );
}
