/**
 * D1 schema (SPEC §8). Phase 0 creates the curriculum reference tables so the
 * app can report honestly that nothing has been imported yet; learner and
 * session tables arrive with the phases that use them.
 *
 * Timestamps are ISO-8601 UTC strings. Identity of a curriculum item is the
 * immutable (edition_id, item_type, source_id) triple.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
