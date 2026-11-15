/**
 * API contracts (SPEC §9). Every request and response is validated with these
 * schemas on the server, and responses are re-validated on the client.
 */
import { z } from "zod";
import { HSK_BANDS, ITEM_TYPES } from "./curriculum";
import { ownerSettingsSchema } from "./settings";
import { COLLOQUIAL_CHANNELS, COLLOQUIAL_REGISTERS, CURRENCY_STATUSES } from "./colloquial";

export const API_PREFIX = "/api/v1";

// --- Errors -----------------------------------------------------------------

export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "CURRICULUM_MISSING",
  "PROVIDER_UNAVAILABLE",
  "AUTH_NOT_CONFIGURED",
  "CONFIG_INVALID",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// --- GET /health ------------------------------------------------------------

export const healthResponseSchema = z.object({
  ready: z.boolean(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// --- Providers --------------------------------------------------------------

/**
 * `live`    — a credential is configured (not proof that the provider works).
 * `mock`    — local fake provider; no external calls, no cost.
 * `missing` — production without a credential; the feature is unavailable.
 */
export const providerModeSchema = z.enum(["live", "mock", "missing"]);
export type ProviderMode = z.infer<typeof providerModeSchema>;

export const providerStatusSchema = z.object({
  id: z.enum(["tutor", "speech"]),
  vendor: z.string(),
  mode: providerModeSchema,
  model: z.string().nullable(),
  setupHint: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

// --- GET /me ----------------------------------------------------------------

export const meResponseSchema = z.object({
  owner: z.object({
    email: z.string().nullable(),
    authMode: z.enum(["access", "dev-bypass"]),
  }),
  /** Saved preferences, or the defaults when nothing has been saved. */
  settings: ownerSettingsSchema,
  providers: z.array(providerStatusSchema),
  curriculumImported: z.boolean(),
  version: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- GET /curriculum/status -------------------------------------------------

/**
 * `missing`  — no rows imported for this dimension.
 * `imported` — rows exist but do not (yet) pass the edition's integrity checks,
 *              or come from an unverified secondary transcription.
 * `verified` — rows match the published totals for the edition and came from
 *              a validated import with a recorded source manifest.
 */
export const dimensionStatusSchema = z.enum(["missing", "imported", "verified"]);
export type DimensionStatus = z.infer<typeof dimensionStatusSchema>;

export const curriculumStatusResponseSchema = z.object({
  activeEdition: z
    .object({
      id: z.string(),
      publisher: z.string(),
      editionDate: z.string(),
      /** True for generated placeholder data, which must never be shown as HSK content. */
      synthetic: z.boolean(),
    })
    .nullable(),
  dimensions: z.array(
    z.object({
      itemType: z.enum(ITEM_TYPES),
      status: dimensionStatusSchema,
      importedCount: z.number().int().nonnegative(),
      /** Published total to validate against; null when no total is verified. */
      expectedCount: z.number().int().positive().nullable(),
    }),
  ),
  vocabByBand: z.array(
    z.object({
      band: z.enum(HSK_BANDS),
      importedNew: z.number().int().nonnegative(),
      expectedNew: z.number().int().positive(),
      expectedCumulative: z.number().int().positive(),
    }),
  ),
  manifests: z.array(
    z.object({
      datasetKind: z.string(),
      sourceUrl: z.string(),
      commitSha: z.string().nullable(),
      sha256: z.string(),
      rightsNote: z.string(),
      fieldMappingVersion: z.string(),
      verificationStatus: z.enum(["verified", "unverified"]),
      recordCount: z.number().int().nonnegative(),
      importedAt: z.string(),
    }),
  ),
});
export type CurriculumStatusResponse = z.infer<typeof curriculumStatusResponseSchema>;

// --- GET /curriculum/items --------------------------------------------------

export const ITEMS_PAGE_SIZE_DEFAULT = 50;
export const ITEMS_PAGE_SIZE_MAX = 100;

/** Query string of GET /curriculum/items. Everything arrives as text. */
export const curriculumItemsQuerySchema = z.object({
  band: z.enum(HSK_BANDS).optional(),
  type: z.enum(ITEM_TYPES).default("vocab"),
  /** One part-of-speech tag exactly as the syllabus writes it, e.g. 名. */
  pos: z.string().trim().min(1).max(20).optional(),
  /** Matches the start of the written form or any part of the pinyin. */
  q: z.string().trim().min(1).max(40).optional(),
  /**
   * Learner state. No practice evidence is recorded yet, so every item is
   * `unseen`; the other states become meaningful with Phase 4.
   */
  state: z.enum(["unseen", "introduced", "practiced", "developing", "mastered"]).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(ITEMS_PAGE_SIZE_MAX).default(ITEMS_PAGE_SIZE_DEFAULT),
});
export type CurriculumItemsQuery = z.infer<typeof curriculumItemsQuerySchema>;

export const curriculumItemSummarySchema = z.object({
  id: z.string(),
  sourceId: z.number().int().positive(),
  itemType: z.enum(ITEM_TYPES),
  hskBand: z.enum(HSK_BANDS),
  hanzi: z.string(),
  pinyin: z.string().nullable(),
  partOfSpeech: z.string().nullable(),
  homograph: z.string().nullable(),
  levelLabel: z.string().nullable(),
});
export type CurriculumItemSummary = z.infer<typeof curriculumItemSummarySchema>;

export const curriculumItemsResponseSchema = z.object({
  editionId: z.string().nullable(),
  synthetic: z.boolean(),
  items: z.array(curriculumItemSummarySchema),
  /** Number of items matching the filters, across all pages. */
  total: z.number().int().nonnegative(),
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type CurriculumItemsResponse = z.infer<typeof curriculumItemsResponseSchema>;

// --- GET /curriculum/facets -------------------------------------------------

export const curriculumFacetsResponseSchema = z.object({
  /** Part-of-speech tags present in the band, most common first. */
  partsOfSpeech: z.array(z.object({ tag: z.string(), count: z.number().int().positive() })),
});
export type CurriculumFacetsResponse = z.infer<typeof curriculumFacetsResponseSchema>;

// --- GET /curriculum/items/:id ----------------------------------------------

export const curriculumItemDetailResponseSchema = z.object({
  item: curriculumItemSummarySchema.extend({
    /** The entry exactly as the syllabus prints it, e.g. 本1. */
    entryRaw: z.string().nullable(),
    sourcePdfPage: z.number().int().nullable(),
    /** Null unless a gloss was imported from a separate, named source. */
    definition: z.string().nullable(),
    definitionProvenance: z.string().nullable(),
  }),
  edition: z.object({
    id: z.string(),
    publisher: z.string(),
    editionDate: z.string(),
    synthetic: z.boolean(),
    isActive: z.boolean(),
  }),
  /** Other numbered entries in the same edition with the same written form. */
  homographs: z.array(curriculumItemSummarySchema),
  /** Where this entry's data came from; empty if no manifest is recorded. */
  sources: z.array(
    z.object({
      sourceUrl: z.string(),
      commitSha: z.string().nullable(),
      rightsNote: z.string(),
      importedAt: z.string(),
    }),
  ),
  /** Null until practice evidence is recorded (Phase 4). */
  progress: z.null(),
});
export type CurriculumItemDetailResponse = z.infer<typeof curriculumItemDetailResponseSchema>;

// --- GET /colloquial --------------------------------------------------------
// A separate track from the HSK syllabus: nothing here has an HSK band and
// nothing here is part of any HSK count (SPEC §2.3, FR-017).

export const colloquialQuerySchema = z.object({
  register: z.enum(COLLOQUIAL_REGISTERS).optional(),
  channel: z.enum(COLLOQUIAL_CHANNELS).optional(),
  status: z.enum(CURRENCY_STATUSES).optional(),
  /** Matches any part of the term, pinyin or meaning. */
  q: z.string().trim().min(1).max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ITEMS_PAGE_SIZE_MAX).default(ITEMS_PAGE_SIZE_DEFAULT),
});
export type ColloquialQuery = z.infer<typeof colloquialQuerySchema>;

export const colloquialExpressionSchema = z.object({
  id: z.string(),
  sourceKey: z.string(),
  term: z.string(),
  pinyin: z.string().nullable(),
  meaningEn: z.string(),
  literalEn: z.string().nullable(),
  category: z.string().nullable(),
  register: z.enum(COLLOQUIAL_REGISTERS),
  channel: z.enum(COLLOQUIAL_CHANNELS),
  region: z.string().nullable(),
  currencyStatus: z.enum(CURRENCY_STATUSES),
  inUseSince: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  sourceUrl: z.string(),
  verificationStatus: z.enum(["verified", "unverified"]),
});
export type ColloquialExpression = z.infer<typeof colloquialExpressionSchema>;

export const colloquialSourceSchema = z.object({
  key: z.string(),
  name: z.string(),
  homepage: z.string().nullable(),
  license: z.string(),
  licenseUrl: z.string().nullable(),
  attribution: z.string(),
  synthetic: z.boolean(),
  /** Expressions imported from this source, regardless of filters. */
  count: z.number().int().nonnegative(),
  datasetVersion: z.string().nullable(),
  importedAt: z.string().nullable(),
});
export type ColloquialSourceStatus = z.infer<typeof colloquialSourceSchema>;

export const colloquialResponseSchema = z.object({
  items: z.array(colloquialExpressionSchema),
  /** Number of expressions matching the filters, across all pages. */
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  /** Every source with imported expressions, for credit and licence display. */
  sources: z.array(colloquialSourceSchema),
});
export type ColloquialResponse = z.infer<typeof colloquialResponseSchema>;
