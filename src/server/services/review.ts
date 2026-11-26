/**
 * Review cards, ratings and the mastery they lead to (SPEC §5.5, §6.1).
 *
 * Cards are made when a session is finished, one per template for each word
 * the session targeted at the study band or for review. Stretch words are
 * left out: they are for exposure, not counted toward mastery (SPEC §2.4).
 * Scheduling is FSRS with fuzz off, so the same history gives the same due
 * times. Every rating is kept in `review_events` and becomes a recall attempt
 * in `practice_attempts`; mastery is worked out from those attempts again on
 * each rating, never set directly.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { Rating, State, createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import { getEdition, type HskBand } from "../../shared/curriculum";
import type { MasteryState, Skill } from "../../shared/learning";
import {
  REVIEW_TEMPLATES,
  TEMPLATE_SKILL,
  deriveMastery,
  type CardState,
  type DueResponse,
  type RateRequest,
  type RateResponse,
  type ReviewCard,
  type ReviewRating,
  type ReviewTemplate,
} from "../../shared/review";
import { OWNER_ID } from "../db/schema";
import { ApiError } from "../validation/errors";
import { getSettings } from "./settings";

/** Fuzz off: scheduling is deterministic for a given history and clock. */
const scheduler = fsrs({ enable_fuzz: false });

const RATINGS: Readonly<Record<ReviewRating, Grade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const CARD_STATES: Readonly<Record<number, CardState>> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

/** A recall counts as successful unless rated Again. */
export function isSuccess(rating: ReviewRating): boolean {
  return rating !== "again";
}

// --- FSRS card storage ---------------------------------------------------------

interface StoredCard {
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export function serializeCard(card: Card): string {
  const stored: StoredCard = {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
  return JSON.stringify(stored);
}

export function deserializeCard(json: string): Card {
  const s = JSON.parse(json) as StoredCard;
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    // Kept for the library's types; FSRS 6 works from last_review.
    elapsed_days: 0,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  } as Card;
}

/** The next card after a rating, and when each rating would schedule it. */
export function schedule(card: Card, now: Date, rating: ReviewRating): Card {
  return scheduler.next(card, now, RATINGS[rating]).card;
}

export function preview(card: Card, now: Date): ReviewCard["preview"] {
  const log = scheduler.repeat(card, now);
  const at = (rating: ReviewRating) => log[RATINGS[rating]].card.due.toISOString();
  return { again: at("again"), hard: at("hard"), good: at("good"), easy: at("easy") };
}

// --- Mastery -------------------------------------------------------------------

/** When a finished session first targeted the word (not as stretch). */
async function introducedAt(d1: D1Database, itemId: string): Promise<string | null> {
  const row = await d1
    .prepare(
      `SELECT MIN(COALESCE(s.started_at, s.ended_at)) AS at FROM session_targets st JOIN sessions s ON s.id = st.session_id
WHERE st.curriculum_item_id = ?1 AND st.role <> 'stretch' AND s.status = 'complete'`,
    )
    .bind(itemId)
    .first<{ at: string | null }>();
  return row?.at ?? null;
}

/** Works the state out again from the evidence and stores it. */
export async function recomputeMastery(d1: D1Database, itemId: string, skill: Skill, timeZone: string, now: Date): Promise<MasteryState> {
  const [introduced, attempts] = await Promise.all([
    introducedAt(d1, itemId),
    d1
      .prepare(
        "SELECT attempted_at, success FROM practice_attempts WHERE curriculum_item_id = ?1 AND skill = ?2 AND is_qualifying_recall = 1",
      )
      .bind(itemId, skill)
      .all<{ attempted_at: string; success: number }>(),
  ]);
  const summary = deriveMastery({
    introducedAt: introduced,
    attempts: attempts.results.map((a) => ({ attemptedAt: a.attempted_at, success: a.success === 1 })),
    timeZone,
  });
  await d1
    .prepare(
      `INSERT INTO mastery_states (owner_id, curriculum_item_id, skill, state, first_seen_at, last_attempt_at, last_success_at, success_days, failure_count, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
ON CONFLICT (owner_id, curriculum_item_id, skill) DO UPDATE SET
  state = excluded.state, first_seen_at = excluded.first_seen_at, last_attempt_at = excluded.last_attempt_at,
  last_success_at = excluded.last_success_at, success_days = excluded.success_days, failure_count = excluded.failure_count,
  updated_at = excluded.updated_at`,
    )
    .bind(
      OWNER_ID,
      itemId,
      skill,
      summary.state,
      summary.firstSeenAt,
      summary.lastAttemptAt,
      summary.lastSuccessAt,
      summary.successDays,
      summary.failureCount,
      now.toISOString(),
    )
    .run();
  return summary.state;
}

/**
 * Called when a session is finished: the words it targeted (stretch words
 * excepted) get review cards, due now, and become `introduced`. Repeating it
 * creates nothing twice.
 */
export async function introduceSessionWords(d1: D1Database, sessionId: string, now: Date = new Date()): Promise<number> {
  const [rows, session] = await Promise.all([
    d1
      .prepare("SELECT curriculum_item_id AS id FROM session_targets WHERE session_id = ?1 AND role <> 'stretch' ORDER BY position")
      .bind(sessionId)
      .all<{ id: string }>(),
    d1.prepare("SELECT started_at FROM sessions WHERE id = ?1").bind(sessionId).first<{ started_at: string | null }>(),
  ]);
  if (rows.results.length === 0) return 0;

  const at = now.toISOString();
  const metAt = session?.started_at ?? at;
  const empty = serializeCard(createEmptyCard(now));
  const inserts = rows.results.flatMap(({ id }) =>
    REVIEW_TEMPLATES.map((template) =>
      d1
        .prepare(
          `INSERT INTO review_cards (id, owner_id, curriculum_item_id, skill, template, fsrs_state_json, due_at, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7) ON CONFLICT (curriculum_item_id, template) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), OWNER_ID, id, TEMPLATE_SKILL[template], template, empty, at),
    ),
  );
  // Becoming introduced. A word that already has a state keeps it: attempts
  // come only from cards, which exist only after a word was first met, so an
  // earlier row already holds the right first-seen time. This gives the same
  // result as deriving it again, in one batch.
  const introductions = rows.results.flatMap(({ id }) =>
    REVIEW_TEMPLATES.map((template) =>
      d1
        .prepare(
          `INSERT INTO mastery_states (owner_id, curriculum_item_id, skill, state, first_seen_at, updated_at)
VALUES (?1, ?2, ?3, 'introduced', ?4, ?5) ON CONFLICT (owner_id, curriculum_item_id, skill) DO NOTHING`,
        )
        .bind(OWNER_ID, id, TEMPLATE_SKILL[template], metAt, at),
    ),
  );
  const results = await d1.batch([...inserts, ...introductions]);
  return results.slice(0, inserts.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

// --- Due cards -----------------------------------------------------------------

interface CardRow {
  id: string;
  template: string;
  skill: string;
  fsrs_state_json: string;
  due_at: string;
  updated_at: string;
  curriculum_item_id: string;
  edition_id: string;
  hsk_band: string;
  hanzi: string;
  pinyin: string | null;
  definition: string | null;
  definition_provenance: string | null;
  mastery: string | null;
}

const CARD_SELECT = `SELECT rc.id, rc.template, rc.skill, rc.fsrs_state_json, rc.due_at, rc.updated_at, rc.curriculum_item_id,
  ci.edition_id, ci.hsk_band, ci.hanzi, ci.pinyin, ci.definition, ci.definition_provenance, ms.state AS mastery
FROM review_cards rc
JOIN curriculum_items ci ON ci.id = rc.curriculum_item_id
LEFT JOIN mastery_states ms ON ms.owner_id = rc.owner_id AND ms.curriculum_item_id = rc.curriculum_item_id AND ms.skill = rc.skill`;

function toView(row: CardRow, now: Date): ReviewCard {
  const card = deserializeCard(row.fsrs_state_json);
  return {
    id: row.id,
    template: row.template as ReviewTemplate,
    skill: row.skill as Skill,
    item: {
      id: row.curriculum_item_id,
      editionId: row.edition_id,
      synthetic: getEdition(row.edition_id)?.synthetic ?? false,
      hskBand: row.hsk_band as HskBand,
      hanzi: row.hanzi,
      pinyin: row.pinyin,
      // A definition is shown only with its source recorded.
      definition: row.definition_provenance ? row.definition : null,
      definitionProvenance: row.definition ? row.definition_provenance : null,
    },
    state: CARD_STATES[card.state] ?? "new",
    dueAt: row.due_at,
    reps: card.reps,
    lapses: card.lapses,
    preview: preview(card, now),
    mastery: (row.mastery ?? "introduced") as MasteryState,
  };
}

export async function listDue(d1: D1Database, limit: number, now: Date = new Date()): Promise<DueResponse> {
  const at = now.toISOString();
  const [due, counts] = await d1.batch<CardRow | { due: number; total: number; next: string | null }>([
    d1.prepare(`${CARD_SELECT} WHERE rc.owner_id = ?1 AND rc.due_at <= ?2 ORDER BY rc.due_at, rc.id LIMIT ?3`).bind(OWNER_ID, at, limit),
    d1
      .prepare(
        `SELECT SUM(CASE WHEN due_at <= ?2 THEN 1 ELSE 0 END) AS due, COUNT(*) AS total,
  MIN(CASE WHEN due_at > ?2 THEN due_at END) AS next
FROM review_cards WHERE owner_id = ?1`,
      )
      .bind(OWNER_ID, at),
  ]);
  const totals = (counts?.results[0] ?? { due: 0, total: 0, next: null }) as { due: number | null; total: number; next: string | null };
  return {
    cards: ((due?.results ?? []) as CardRow[]).map((row) => toView(row, now)),
    dueCount: totals.due ?? 0,
    totalCards: totals.total,
    nextDueAt: (totals.due ?? 0) > 0 ? null : totals.next,
  };
}

// --- Rating --------------------------------------------------------------------

async function replayed(d1: D1Database, cardId: string, clientEventId: string): Promise<RateResponse | null> {
  const event = await d1
    .prepare("SELECT review_card_id, rating, state_after_json FROM review_events WHERE client_event_id = ?1")
    .bind(clientEventId)
    .first<{ review_card_id: string; rating: string; state_after_json: string }>();
  if (!event) return null;
  if (event.review_card_id !== cardId) throw new ApiError("CONFLICT", "That clientEventId was already used for another card.");
  const after = deserializeCard(event.state_after_json);
  const row = await d1
    .prepare("SELECT ms.state FROM review_cards rc LEFT JOIN mastery_states ms ON ms.owner_id = rc.owner_id AND ms.curriculum_item_id = rc.curriculum_item_id AND ms.skill = rc.skill WHERE rc.id = ?1")
    .bind(cardId)
    .first<{ state: string | null }>();
  return {
    cardId,
    rating: event.rating as ReviewRating,
    nextDueAt: after.due.toISOString(),
    state: CARD_STATES[after.state] ?? "new",
    mastery: (row?.state ?? "introduced") as MasteryState,
    replayed: true,
  };
}

/**
 * Records a rating once per clientEventId. The event, the card's new
 * schedule and the recall attempt are written together, and only if the card
 * has not been rated by another request in the meantime.
 */
export async function rateCard(d1: D1Database, cardId: string, request: RateRequest, now: Date = new Date()): Promise<RateResponse> {
  if (!/^[0-9a-f-]{36}$/.test(cardId)) throw new ApiError("BAD_REQUEST", "That is not a card id.");
  const earlier = await replayed(d1, cardId, request.clientEventId);
  if (earlier) return earlier;

  const row = await d1
    .prepare("SELECT id, curriculum_item_id, skill, template, fsrs_state_json, updated_at FROM review_cards WHERE id = ?1 AND owner_id = ?2")
    .bind(cardId, OWNER_ID)
    .first<{ id: string; curriculum_item_id: string; skill: string; template: string; fsrs_state_json: string; updated_at: string }>();
  if (!row) throw new ApiError("NOT_FOUND", "No such review card.");

  const before = deserializeCard(row.fsrs_state_json);
  const after = schedule(before, now, request.rating);
  const elapsedDays = before.last_review ? Math.max(0, (now.getTime() - before.last_review.getTime()) / 86_400_000) : 0;
  const at = now.toISOString();
  const eventId = crypto.randomUUID();
  // Every write is conditional on the card being as it was read.
  const unchanged = "EXISTS (SELECT 1 FROM review_cards WHERE id = ?1 AND updated_at = ?2)";
  const recorded = "EXISTS (SELECT 1 FROM review_events WHERE id = ?1)";

  await d1.batch([
    d1
      .prepare(
        `INSERT INTO review_events (id, review_card_id, client_event_id, rating, elapsed_days, state_before_json, state_after_json, created_at)
SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${unchanged}
ON CONFLICT (client_event_id) DO NOTHING`,
      )
      .bind(cardId, row.updated_at, eventId, request.clientEventId, request.rating, Math.round(elapsedDays * 10_000) / 10_000, row.fsrs_state_json, serializeCard(after), at),
    d1
      .prepare(`UPDATE review_cards SET fsrs_state_json = ?3, due_at = ?4, updated_at = ?5 WHERE id = ?1 AND updated_at = ?2 AND EXISTS (SELECT 1 FROM review_events WHERE id = ?6)`)
      .bind(cardId, row.updated_at, serializeCard(after), after.due.toISOString(), at, eventId),
    d1
      .prepare(
        `INSERT INTO practice_attempts (id, session_id, curriculum_item_id, skill, assessment_type, prompt_id, score, score_source, is_qualifying_recall, success, review_event_id, attempted_at)
SELECT ?2, NULL, ?3, ?4, 'review_self_rating', ?5, ?6, 'self', 1, ?7, ?1, ?8 WHERE ${recorded}`,
      )
      .bind(eventId, crypto.randomUUID(), row.curriculum_item_id, row.skill, row.template, RATINGS[request.rating], isSuccess(request.rating) ? 1 : 0, at),
  ]);

  const saved = await d1.prepare("SELECT 1 AS ok FROM review_events WHERE id = ?1").bind(eventId).first<{ ok: number }>();
  if (!saved) {
    // Either the same rating arrived twice at once, or the card was rated elsewhere first.
    const again = await replayed(d1, cardId, request.clientEventId);
    if (again) return again;
    throw new ApiError("CONFLICT", "This card was just rated from somewhere else. Reload to see it as it is now.", true);
  }

  const { timezone: timeZone } = await getSettings(d1);
  const mastery = await recomputeMastery(d1, row.curriculum_item_id, row.skill as Skill, timeZone, now);
  return {
    cardId,
    rating: request.rating,
    nextDueAt: after.due.toISOString(),
    state: CARD_STATES[after.state] ?? "new",
    mastery,
    replayed: false,
  };
}
