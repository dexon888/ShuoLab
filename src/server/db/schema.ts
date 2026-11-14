/**
 * D1 schema (SPEC §8). Phase 0 creates the curriculum reference tables so the
 * app can report honestly that nothing has been imported yet; learner and
 * session tables arrive with the phases that use them.
 *
 * Timestamps are ISO-8601 UTC strings. Identity of a curriculum item is the
 * immutable (edition_id, item_type, source_id) triple.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
