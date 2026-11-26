/**
 * D1 schema (SPEC §8). Phase 0 creates the curriculum reference tables so the
 * app can report honestly that nothing has been imported yet; learner and
 * session tables arrive with the phases that use them.
 *
 * Timestamps are ISO-8601 UTC strings. Identity of a curriculum item is the
 * immutable (edition_id, item_type, source_id) triple.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const curriculumEditions = sqliteTable("curriculum_editions", {
  id: text("id").primaryKey(),
  publisher: text("publisher").notNull(),
  editionDate: text("edition_date").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
});

export const sourceManifests = sqliteTable(
  "source_manifests",
  {
    id: text("id").primaryKey(),
    editionId: text("edition_id")
      .notNull()
      .references(() => curriculumEditions.id),
    datasetKind: text("dataset_kind").notNull(),
    sourceUrl: text("source_url").notNull(),
    commitSha: text("commit_sha"),
    sha256: text("sha256").notNull(),
    rightsNote: text("rights_note").notNull(),
    fieldMappingVersion: text("field_mapping_version").notNull(),
    /** `verified` only after the edition's integrity checks pass. */
    verificationStatus: text("verification_status").notNull().default("unverified"),
    recordCount: integer("record_count").notNull(),
    importedAt: text("imported_at").notNull(),
  },
  (t) => [
    index("source_manifests_edition_kind_idx").on(t.editionId, t.datasetKind),
    check(
      "source_manifests_verification_status_check",
      sql`${t.verificationStatus} IN ('verified','unverified')`,
    ),
  ],
);

export const curriculumItems = sqliteTable(
  "curriculum_items",
  {
    /** `edition:type:sourceId` */
    id: text("id").primaryKey(),
    editionId: text("edition_id")
      .notNull()
      .references(() => curriculumEditions.id),
    sourceId: integer("source_id").notNull(),
    itemType: text("item_type").notNull(),
    hskBand: text("hsk_band").notNull(),
    hanzi: text("hanzi").notNull(),
    entryRaw: text("entry_raw"),
    pinyin: text("pinyin"),
    partOfSpeech: text("part_of_speech"),
    homograph: text("homograph"),
    levelLabel: text("level_label"),
    sourcePdfPage: integer("source_pdf_page"),
    /** May be null: the syllabus is not an English dictionary (SPEC §15.3). */
    definition: text("definition"),
    definitionProvenance: text("definition_provenance"),
    metadataJson: text("metadata_json"),
  },
  (t) => [
    uniqueIndex("curriculum_items_edition_type_source_uq").on(t.editionId, t.itemType, t.sourceId),
    index("curriculum_items_edition_type_band_idx").on(t.editionId, t.itemType, t.hskBand),
    check(
      "curriculum_items_item_type_check",
      sql`${t.itemType} IN ('vocab','grammar','character','topic','task')`,
    ),
    check("curriculum_items_hsk_band_check", sql`${t.hskBand} IN ('1','2','3','4','5','6','7-9')`),
    check("curriculum_items_source_id_check", sql`${t.sourceId} >= 1`),
  ],
);

/**
 * Colloquial expressions (SPEC §2.3): a separate namespace from the HSK
 * syllabus. There is deliberately no HSK band column, so these rows cannot
 * enter any HSK count.
 */
export const colloquialExpressions = sqliteTable(
  "colloquial_expressions",
  {
    /** `colloquial:<source_key>:<slug>` */
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    slug: text("slug").notNull(),
    term: text("term").notNull(),
    pinyin: text("pinyin"),
    meaningEn: text("meaning_en").notNull(),
    literalEn: text("literal_en"),
    category: text("category"),
    register: text("register").notNull(),
    channel: text("channel").notNull(),
    region: text("region"),
    currencyStatus: text("currency_status").notNull().default("unknown"),
    inUseSince: text("in_use_since"),
    /** When the source last checked the currency status (YYYY-MM or YYYY-MM-DD). */
    lastVerifiedAt: text("last_verified_at"),
    sourceUrl: text("source_url").notNull(),
    license: text("license").notNull(),
    attribution: text("attribution").notNull(),
    /** `unverified` for anything not taken from a reviewed source (e.g. AI proposals). */
    verificationStatus: text("verification_status").notNull().default("unverified"),
    datasetVersion: text("dataset_version"),
    fileSha256: text("file_sha256"),
    importedAt: text("imported_at").notNull(),
  },
  (t) => [
    uniqueIndex("colloquial_expressions_source_slug_uq").on(t.sourceKey, t.slug),
    check(
      "colloquial_expressions_register_check",
      sql`${t.register} IN ('formal','neutral','casual','very_informal')`,
    ),
    check("colloquial_expressions_channel_check", sql`${t.channel} IN ('spoken','typed','both')`),
    check(
      "colloquial_expressions_currency_status_check",
      sql`${t.currencyStatus} IN ('hot','steady','fading','unknown')`,
    ),
    check(
      "colloquial_expressions_verification_status_check",
      sql`${t.verificationStatus} IN ('verified','unverified')`,
    ),
  ],
);

/**
 * Owner preferences (SPEC §8). The app has exactly one owner, so the table
 * holds at most one row: the CHECK allows only the fixed id.
 */
export const ownerSettings = sqliteTable(
  "owner_settings",
  {
    ownerId: text("owner_id").primaryKey(),
    nickname: text("nickname"),
    locale: text("locale").notNull().default("zh-Hans"),
    timezone: text("timezone").notNull(),
    sessionMinutes: integer("session_minutes").notNull(),
    studyBand: text("study_band"),
    displayMode: text("display_mode").notNull(),
    speechRate: real("speech_rate").notNull(),
    slangIntensity: text("slang_intensity").notNull(),
    selfRatedListening: text("self_rated_listening"),
    selfRatedSpeaking: text("self_rated_speaking"),
    limitsJson: text("limits_json").notNull(),
    onboardedAt: text("onboarded_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("owner_settings_single_owner_check", sql`${t.ownerId} = 'owner'`),
    check("owner_settings_session_minutes_check", sql`${t.sessionMinutes} IN (15,20,25,30)`),
    check(
      "owner_settings_study_band_check",
      sql`${t.studyBand} IS NULL OR ${t.studyBand} IN ('1','2','3','4','5','6','7-9')`,
    ),
    check("owner_settings_speech_rate_check", sql`${t.speechRate} >= 0.75 AND ${t.speechRate} <= 1.15`),
    check("owner_settings_slang_intensity_check", sql`${t.slangIntensity} IN ('low','normal','high')`),
  ],
);

/**
 * Practice sessions (SPEC §8). `plan_json` is the planner's output, fixed
 * when the session is created.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default("owner"),
    /** `hsk` sessions use imported syllabus entries; `free_chat` sessions use none. */
    kind: text("kind").notNull(),
    /** Null for free chat. */
    editionId: text("edition_id").references(() => curriculumEditions.id),
    /** The owner's calendar date in their time zone, YYYY-MM-DD. */
    localStudyDate: text("local_study_date").notNull(),
    durationTargetMin: integer("duration_target_min").notNull(),
    status: text("status").notNull().default("planned"),
    planJson: text("plan_json").notNull(),
    actualSeconds: integer("actual_seconds").notNull().default(0),
    /** The tutor model used, once a turn has been taken. */
    model: text("model"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    /** When the learner last did something in the session. Practice time is counted between these moments. */
    lastActivityAt: text("last_activity_at"),
  },
  (t) => [
    index("sessions_date_idx").on(t.localStudyDate),
    index("sessions_created_idx").on(t.createdAt),
    check("sessions_owner_check", sql`${t.ownerId} = 'owner'`),
    check("sessions_kind_check", sql`${t.kind} IN ('hsk','free_chat')`),
    check(
      "sessions_status_check",
      sql`${t.status} IN ('planned','active','paused','complete','abandoned')`,
    ),
    check("sessions_duration_check", sql`${t.durationTargetMin} IN (15,20,25,30)`),
    // A free-chat session never carries an edition, and an HSK one always does.
    check(
      "sessions_kind_edition_check",
      sql`(${t.kind} = 'hsk' AND ${t.editionId} IS NOT NULL) OR (${t.kind} = 'free_chat' AND ${t.editionId} IS NULL)`,
    ),
  ],
);

/**
 * The syllabus entries a session targets. The foreign key means a plan can
 * only reference entries that were really imported.
 */
export const sessionTargets = sqliteTable(
  "session_targets",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    curriculumItemId: text("curriculum_item_id")
      .notNull()
      .references(() => curriculumItems.id),
    role: text("role").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.curriculumItemId] }),
    index("session_targets_item_idx").on(t.curriculumItemId),
    check("session_targets_role_check", sql`${t.role} IN ('active','review','stretch')`),
  ],
);

/**
 * One row per learner message and the tutor's answer to it (SPEC §8.2). The
 * unique (session_id, client_turn_id) pair is what makes a resent message
 * land on the same row instead of creating a second turn. No audio is stored.
 *
 * A row is written as `pending` before the tutor is called and becomes
 * `complete` when the answer is saved, or `failed` when the call did not
 * produce one. Only `complete` rows are part of the conversation.
 */
export const conversationTurns = sqliteTable(
  "conversation_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    clientTurnId: text("client_turn_id").notNull(),
    /** `speech` or `typed`. A typed turn is never counted as speaking practice. */
    sourceMode: text("source_mode").notNull(),
    /** The learner's words: the recognized transcript for speech, the typed text otherwise. */
    asrText: text("asr_text").notNull(),
    asrUncertain: integer("asr_uncertain", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("pending"),
    aiReplyZh: text("ai_reply_zh"),
    /** The validated reply as returned to the client. Never the raw model output. */
    aiReplyJson: text("ai_reply_json"),
    isFallback: integer("is_fallback", { mode: "boolean" }).notNull().default(false),
    model: text("model"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    /** When the tutor's reply was first played aloud. */
    replyPlayedAt: text("reply_played_at"),
    /** When the reply's text was first shown after being hidden for listening. */
    transcriptRevealedAt: text("transcript_revealed_at"),
  },
  (t) => [
    uniqueIndex("conversation_turns_client_idx").on(t.sessionId, t.clientTurnId),
    index("conversation_turns_session_idx").on(t.sessionId, t.createdAt),
    check("conversation_turns_mode_check", sql`${t.sourceMode} IN ('speech','typed')`),
    check("conversation_turns_status_check", sql`${t.status} IN ('pending','complete','failed')`),
    // A finished turn always has its reply.
    check(
      "conversation_turns_complete_check",
      sql`${t.status} <> 'complete' OR (${t.aiReplyZh} IS NOT NULL AND ${t.aiReplyJson} IS NOT NULL)`,
    ),
  ],
);

/**
 * The "Listen first" exercise (SPEC §5.3 step 2, §6.5): one per session. The
 * exchange and questions are stored as validated JSON, never raw model text.
 * The answers are kept as first sent, and the reveal time beside them, so an
 * answer given after reading the text is never counted as listening.
 */
export const listeningExercises = sqliteTable(
  "listening_exercises",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    /** `generated` by the tutor model, or `prepared` for ShuoLab when generation failed. */
    source: text("source"),
    model: text("model"),
    standIn: integer("stand_in", { mode: "boolean" }).notNull().default(false),
    /** `{lines, questions}` after validation and option shuffling. */
    contentJson: text("content_json"),
    createdAt: text("created_at").notNull(),
    playedAt: text("played_at"),
    revealedAt: text("revealed_at"),
    answeredAt: text("answered_at"),
    answersJson: text("answers_json"),
    correctCount: integer("correct_count"),
    questionCount: integer("question_count"),
  },
  (t) => [
    uniqueIndex("listening_exercises_session_idx").on(t.sessionId),
    check("listening_exercises_status_check", sql`${t.status} IN ('pending','ready','failed')`),
    check("listening_exercises_ready_check", sql`${t.status} <> 'ready' OR (${t.contentJson} IS NOT NULL AND ${t.source} IS NOT NULL)`),
  ],
);

/**
 * The spend ledger (SPEC §4.3, §8.2): one row per provider call, including
 * calls whose answer was rejected. Amounts are this app's estimates. Rows are
 * kept when a session is deleted, so the month's total stays true.
 */
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    audioSeconds: real("audio_seconds").notNull().default(0),
    ttsChars: integer("tts_chars").notNull().default(0),
    estimatedUsd: real("estimated_usd").notNull().default(0),
    /** `ok`: used. `invalid`: answered but rejected by validation. `error`: the call failed. */
    status: text("status").notNull(),
    /** Not a foreign key: the ledger outlives the session. */
    sessionId: text("session_id"),
    /** Set for usage the browser reports, so a resent report is counted once. */
    clientEventId: text("client_event_id"),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [
    index("usage_events_recorded_idx").on(t.recordedAt, t.provider),
    uniqueIndex("usage_events_client_event_idx").on(t.clientEventId),
    check("usage_events_status_check", sql`${t.status} IN ('ok','invalid','error')`),
    check("usage_events_amounts_check", sql`${t.tokensIn} >= 0 AND ${t.tokensOut} >= 0 AND ${t.estimatedUsd} >= 0`),
  ],
);

/** The single owner's id in evidence tables (SPEC §8.2 keeps the column for clarity, not for tenants). */
export const OWNER_ID = "owner";

/**
 * Evidence (SPEC §6.5, §8.2): one row per assessed attempt. Only rows with
 * `is_qualifying_recall` move mastery. Appearing in a lesson is never an
 * attempt. Kept when a session is deleted only if it was not part of one.
 */
export const practiceAttempts = sqliteTable(
  "practice_attempts",
  {
    id: text("id").primaryKey(),
    /** Null for attempts made outside a session, such as reviews. */
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    curriculumItemId: text("curriculum_item_id").references(() => curriculumItems.id, { onDelete: "cascade" }),
    colloquialId: text("colloquial_id"),
    skill: text("skill").notNull(),
    /** `review_self_rating`: the learner rated their own recall on a review card. */
    assessmentType: text("assessment_type").notNull(),
    /** The card template or authored prompt that was answered. */
    promptId: text("prompt_id").notNull(),
    userResponse: text("user_response"),
    score: real("score"),
    /** `self`: the learner's own rating. Never `ai`: model feedback does not mark mastery. */
    scoreSource: text("score_source").notNull(),
    isQualifyingRecall: integer("is_qualifying_recall", { mode: "boolean" }).notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    /** The review event this attempt came from, if any. */
    reviewEventId: text("review_event_id"),
    attemptedAt: text("attempted_at").notNull(),
  },
  (t) => [
    index("practice_attempts_item_skill_idx").on(t.curriculumItemId, t.skill, t.attemptedAt),
    uniqueIndex("practice_attempts_review_event_idx").on(t.reviewEventId),
    check("practice_attempts_skill_check", sql`${t.skill} IN ('listening','speaking','reading','writing')`),
    check("practice_attempts_source_check", sql`${t.scoreSource} IN ('self','rubric')`),
    // One subject: an imported item or a colloquial expression, never both.
    check("practice_attempts_subject_check", sql`(${t.curriculumItemId} IS NULL) <> (${t.colloquialId} IS NULL)`),
  ],
);

/** Derived from `practice_attempts` and session targets; recomputed, never edited by hand. */
export const masteryStates = sqliteTable(
  "mastery_states",
  {
    ownerId: text("owner_id").notNull().default(OWNER_ID),
    curriculumItemId: text("curriculum_item_id")
      .notNull()
      .references(() => curriculumItems.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    state: text("state").notNull(),
    firstSeenAt: text("first_seen_at"),
    lastAttemptAt: text("last_attempt_at"),
    lastSuccessAt: text("last_success_at"),
    successDays: integer("success_days").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.curriculumItemId, t.skill] }),
    check("mastery_states_state_check", sql`${t.state} IN ('unseen','introduced','practiced','developing','mastered')`),
  ],
);

/** One FSRS card per item and template (SPEC §5.5). */
export const reviewCards = sqliteTable(
  "review_cards",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(OWNER_ID),
    curriculumItemId: text("curriculum_item_id")
      .notNull()
      .references(() => curriculumItems.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    template: text("template").notNull(),
    fsrsStateJson: text("fsrs_state_json").notNull(),
    dueAt: text("due_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("review_cards_item_template_idx").on(t.curriculumItemId, t.template),
    index("review_cards_due_idx").on(t.ownerId, t.dueAt),
  ],
);

/** Append-only schedule history: every rating with the card before and after. */
export const reviewEvents = sqliteTable(
  "review_events",
  {
    id: text("id").primaryKey(),
    reviewCardId: text("review_card_id")
      .notNull()
      .references(() => reviewCards.id, { onDelete: "cascade" }),
    clientEventId: text("client_event_id").notNull(),
    rating: text("rating").notNull(),
    elapsedDays: real("elapsed_days").notNull(),
    stateBeforeJson: text("state_before_json").notNull(),
    stateAfterJson: text("state_after_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("review_events_client_event_idx").on(t.clientEventId),
    index("review_events_card_idx").on(t.reviewCardId, t.createdAt),
    check("review_events_rating_check", sql`${t.rating} IN ('again','hard','good','easy')`),
  ],
);
