/**
 * API contracts (SPEC §9). Every request and response is validated with these
 * schemas on the server, and responses are re-validated on the client.
 */
import { z } from "zod";
import { HSK_BANDS, ITEM_TYPES } from "./curriculum";

export const API_PREFIX = "/api/v1";

// --- Errors -----------------------------------------------------------------

export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
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
