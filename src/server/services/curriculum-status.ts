import type { D1Database } from "@cloudflare/workers-types";
import { count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { CurriculumStatusResponse, DimensionStatus } from "../../shared/api";
import {
  HSK_BANDS,
  ITEM_TYPES,
  VOCAB_NEW_ENTRIES_BY_BAND,
  VOCAB_TOTAL_ENTRIES,
  cumulativeVocabEntries,
  getEdition,
  isHskBand,
  type HskBand,
  type ItemType,
} from "../../shared/curriculum";
import { curriculumEditions, curriculumItems, sourceManifests } from "../db/schema";

/**
 * Reports what has actually been imported for the active edition.
 *
 * Vocabulary is `verified` only when every band holds exactly the published
 * number of entries and a verified source manifest exists. Other dimensions have no verified totals yet, so imported
 * rows are reported as `imported` (unverified) and never as verified coverage.
 */
export async function getCurriculumStatus(d1: D1Database): Promise<CurriculumStatusResponse> {
  const db = drizzle(d1);

  const [edition] = await db
    .select()
    .from(curriculumEditions)
    .where(eq(curriculumEditions.isActive, true))
    .limit(1);

  const typeCounts = new Map<ItemType, number>();
  const bandCounts = new Map<HskBand, number>();
  let manifests: CurriculumStatusResponse["manifests"] = [];

  if (edition) {
    const rows = await db
      .select({
        itemType: curriculumItems.itemType,
        hskBand: curriculumItems.hskBand,
        n: count(),
      })
      .from(curriculumItems)
      .where(eq(curriculumItems.editionId, edition.id))
      .groupBy(curriculumItems.itemType, curriculumItems.hskBand);

    for (const row of rows) {
      const type = row.itemType as ItemType;
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + row.n);
      if (type === "vocab" && isHskBand(row.hskBand)) {
        bandCounts.set(row.hskBand, row.n);
      }
    }

    manifests = (
      await db
        .select()
        .from(sourceManifests)
        .where(eq(sourceManifests.editionId, edition.id))
        .orderBy(desc(sourceManifests.importedAt))
    ).map((m) => ({
      datasetKind: m.datasetKind,
      sourceUrl: m.sourceUrl,
      commitSha: m.commitSha,
      sha256: m.sha256,
      rightsNote: m.rightsNote,
      fieldMappingVersion: m.fieldMappingVersion,
      verificationStatus: m.verificationStatus === "verified" ? ("verified" as const) : ("unverified" as const),
      recordCount: m.recordCount,
      importedAt: m.importedAt,
    }));
  }

  const vocabByBand = HSK_BANDS.map((band) => ({
    band,
    importedNew: bandCounts.get(band) ?? 0,
    expectedNew: VOCAB_NEW_ENTRIES_BY_BAND[band],
    expectedCumulative: cumulativeVocabEntries(band),
  }));

  // Counts alone are not enough: the rows must also come from a validated
  // import, which is the only thing that writes a verified vocabulary manifest.
  const vocabVerified =
    vocabByBand.every((b) => b.importedNew === b.expectedNew) &&
    manifests.some((m) => m.datasetKind === "vocab" && m.verificationStatus === "verified");

  const dimensions = ITEM_TYPES.map((itemType) => {
    const importedCount = typeCounts.get(itemType) ?? 0;
    let status: DimensionStatus = importedCount === 0 ? "missing" : "imported";
    if (itemType === "vocab" && vocabVerified) status = "verified";
    return {
      itemType,
      status,
      importedCount,
      expectedCount: itemType === "vocab" ? VOCAB_TOTAL_ENTRIES : null,
    };
  });

  return {
    activeEdition: edition
      ? {
          id: edition.id,
          publisher: edition.publisher,
          editionDate: edition.editionDate,
          synthetic: getEdition(edition.id)?.synthetic ?? false,
        }
      : null,
    dimensions,
    vocabByBand,
    manifests,
  };
}

export function isVocabVerified(status: CurriculumStatusResponse): boolean {
  return status.dimensions.some((d) => d.itemType === "vocab" && d.status === "verified");
}
