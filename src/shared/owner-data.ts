/**
 * The owner's own data: export, re-import, deletion (SPEC §5.7, §8.4;
 * FR-019, SEC-05, SEC-06). Curriculum and colloquial reference data are not
 * the owner's data: they are never exported, imported or deleted here.
 */
import { z } from "zod";

export const EXPORT_FORMAT = "shuolab-export";
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * The owner's tables, parents before children, so an import can insert them
 * in this order. The usage ledger is last: it refers to nothing.
 */
export const OWNER_TABLES = [
  "owner_settings",
  "sessions",
  "session_targets",
  "session_items",
  "session_materials",
  "task_checks",
  "item_flags",
  "conversation_turns",
  "listening_exercises",
  "review_cards",
  "review_events",
  "practice_attempts",
  "mastery_states",
  "usage_events",
] as const;
export type OwnerTable = (typeof OWNER_TABLES)[number];

export const exportDocumentSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string(),
  appVersion: z.string(),
  /** Curriculum editions the data refers to. Their entries are not included. */
  curriculumEditions: z.array(z.string()),
  notes: z.array(z.string()),
  /** Rows exactly as stored, keyed by column name. */
  tables: z.object(
    // A table missing from an older export (one made before it existed) reads as empty.
    Object.fromEntries(OWNER_TABLES.map((t) => [t, z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).default([])])) as Record<
      OwnerTable,
      z.ZodDefault<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodNull]>>>>
    >,
  ),
});
export type ExportDocument = z.infer<typeof exportDocumentSchema>;

export const exportQuerySchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("json") }),
  z.object({ format: z.literal("csv"), table: z.enum(OWNER_TABLES) }),
]);

/** Typed exactly, so a deletion of everything is never one stray click. */
export const DELETE_ALL_PHRASE = "DELETE MY DATA";

export const deleteAllRequestSchema = z.object({ confirm: z.literal(DELETE_ALL_PHRASE) }).strict();

export const deletionResponseSchema = z.object({
  /** Rows removed per table. */
  deleted: z.record(z.string(), z.number().int().nonnegative()),
  /** What was deliberately kept, and why. */
  kept: z.array(z.string()),
});
export type DeletionResponse = z.infer<typeof deletionResponseSchema>;

/** Table summary for the Settings data section. */
export const dataSummaryResponseSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
  transcriptRetentionDays: z.number().int().positive().nullable(),
  /** Sessions whose conversation text retention has already removed. */
  sessionsPastRetention: z.number().int().nonnegative(),
});
export type DataSummaryResponse = z.infer<typeof dataSummaryResponseSchema>;
