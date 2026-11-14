import type { D1Database } from "@cloudflare/workers-types";
import { and, asc, count, desc, eq, gt, ne, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  CurriculumFacetsResponse,
  CurriculumItemDetailResponse,
  CurriculumItemSummary,
  CurriculumItemsQuery,
  CurriculumItemsResponse,
} from "../../shared/api";
import {
  getEdition,
  isHskBand,
  parseCurriculumItemId,
  type HskBand,
  type ItemType,
} from "../../shared/curriculum";
import { curriculumEditions, curriculumItems, sourceManifests } from "../db/schema";
import { ApiError } from "../validation/errors";

type ItemRow = typeof curriculumItems.$inferSelect;

function toSummary(row: ItemRow): CurriculumItemSummary {
  return {
    id: row.id,
    sourceId: row.sourceId,
    itemType: row.itemType as ItemType,
    // The CHECK constraint guarantees a valid band; fall back defensively.
    hskBand: isHskBand(row.hskBand) ? row.hskBand : "1",
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    partOfSpeech: row.partOfSpeech,
    homograph: row.homograph,
    levelLabel: row.levelLabel,
  };
}

// --- Cursor -----------------------------------------------------------------
// Keyset pagination on source_id: stable while rows are added, and cheap.

function encodeCursor(sourceId: number): string {
  return `s${sourceId.toString(36)}`;
}

function decodeCursor(cursor: string): number {
  const match = /^s([0-9a-z]{1,10})$/.exec(cursor);
  const value = match?.[1] ? Number.parseInt(match[1], 36) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError("BAD_REQUEST", "The cursor is not valid. Start again from the first page.");
  }
  return value;
}

// --- Part of speech ---------------------------------------------------------
// The syllabus joins tags with 、 and brackets secondary ones: 数、（副）.

/** `、tag1、tag2、` with brackets removed, so one tag can be matched exactly. */
const DELIMITED_POS = sql`('、' || replace(replace(${curriculumItems.partOfSpeech}, '（', ''), '）', '') || '、')`;

export function splitPartOfSpeech(raw: string): string[] {
  return raw
    .split("、")
    .map((tag) => tag.replace(/[（）()]/g, "").trim())
    .filter((tag) => tag.length > 0);
}

/** Escapes LIKE wildcards so user text is matched literally. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function activeEditionId(d1: D1Database): Promise<string | null> {
  const [edition] = await drizzle(d1)
    .select({ id: curriculumEditions.id })
    .from(curriculumEditions)
    .where(eq(curriculumEditions.isActive, true))
    .limit(1);
  return edition?.id ?? null;
}

export async function listCurriculumItems(
  d1: D1Database,
  query: CurriculumItemsQuery,
): Promise<CurriculumItemsResponse> {
  const editionId = await activeEditionId(d1);
  const empty: CurriculumItemsResponse = {
    editionId,
    synthetic: editionId ? (getEdition(editionId)?.synthetic ?? false) : false,
    items: [],
    total: 0,
    nextCursor: null,
  };
  // No evidence is recorded yet, so nothing can be in any state but `unseen`.
  if (!editionId || (query.state && query.state !== "unseen")) {
    if (query.cursor) decodeCursor(query.cursor);
    return empty;
  }

  const filters: SQL[] = [
    eq(curriculumItems.editionId, editionId),
    eq(curriculumItems.itemType, query.type),
  ];
  if (query.band) filters.push(eq(curriculumItems.hskBand, query.band));
  if (query.pos) {
    filters.push(sql`${DELIMITED_POS} LIKE ${`%、${likeLiteral(query.pos)}、%`} ESCAPE '\\'`);
  }
  if (query.q) {
    const text = likeLiteral(query.q);
    filters.push(
      sql`(${curriculumItems.hanzi} LIKE ${`${text}%`} ESCAPE '\\' OR ${curriculumItems.pinyin} LIKE ${`%${text}%`} ESCAPE '\\')`,
    );
  }

  const db = drizzle(d1);
  const [totals] = await db
    .select({ n: count() })
    .from(curriculumItems)
    .where(and(...filters));

  const pageFilters = query.cursor
    ? [...filters, gt(curriculumItems.sourceId, decodeCursor(query.cursor))]
    : filters;
  // One extra row tells us whether another page exists.
  const rows = await db
    .select()
    .from(curriculumItems)
    .where(and(...pageFilters))
    .orderBy(asc(curriculumItems.sourceId))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    ...empty,
    items: page.map(toSummary),
    total: totals?.n ?? 0,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.sourceId) : null,
  };
}

export async function getCurriculumFacets(
  d1: D1Database,
  band: HskBand | undefined,
): Promise<CurriculumFacetsResponse> {
  const editionId = await activeEditionId(d1);
  if (!editionId) return { partsOfSpeech: [] };

  const filters: SQL[] = [
    eq(curriculumItems.editionId, editionId),
    eq(curriculumItems.itemType, "vocab"),
  ];
  if (band) filters.push(eq(curriculumItems.hskBand, band));

  // Distinct raw values are few (tens to hundreds), so tags are split here.
  const rows = await drizzle(d1)
    .select({ raw: curriculumItems.partOfSpeech, n: count() })
    .from(curriculumItems)
    .where(and(...filters))
    .groupBy(curriculumItems.partOfSpeech);

  const tags = new Map<string, number>();
  for (const row of rows) {
    if (!row.raw) continue;
    for (const tag of new Set(splitPartOfSpeech(row.raw))) {
      tags.set(tag, (tags.get(tag) ?? 0) + row.n);
    }
  }
  return {
    partsOfSpeech: [...tags]
      .map(([tag, n]) => ({ tag, count: n }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}

export async function getCurriculumItem(
  d1: D1Database,
  id: string,
): Promise<CurriculumItemDetailResponse> {
  if (!parseCurriculumItemId(id)) {
    throw new ApiError("BAD_REQUEST", "That is not a valid curriculum item id.");
  }
  const db = drizzle(d1);

  const [row] = await db.select().from(curriculumItems).where(eq(curriculumItems.id, id)).limit(1);
  if (!row) {
    throw new ApiError("NOT_FOUND", "No imported curriculum item has that id.");
  }

  const [edition] = await db
    .select()
    .from(curriculumEditions)
    .where(eq(curriculumEditions.id, row.editionId))
    .limit(1);
  if (!edition) {
    throw new ApiError("NOT_FOUND", "No imported curriculum item has that id.");
  }

  const homographs = await db
    .select()
    .from(curriculumItems)
    .where(
      and(
        eq(curriculumItems.editionId, row.editionId),
        eq(curriculumItems.itemType, row.itemType),
        eq(curriculumItems.hanzi, row.hanzi),
        ne(curriculumItems.id, row.id),
      ),
    )
    .orderBy(asc(curriculumItems.sourceId))
    .limit(20);

  const datasetKind = row.itemType;
  const manifests = await db
    .select()
    .from(sourceManifests)
    .where(
      and(eq(sourceManifests.editionId, row.editionId), eq(sourceManifests.datasetKind, datasetKind)),
    )
    .orderBy(desc(sourceManifests.importedAt));

  // Several files may make up one import; they share a repository and commit.
  const seen = new Set<string>();
  const sources: CurriculumItemDetailResponse["sources"] = [];
  for (const manifest of manifests) {
    const sourceUrl = manifest.sourceUrl.split("#")[0] ?? manifest.sourceUrl;
    const key = `${sourceUrl}@${manifest.commitSha ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      sourceUrl,
      commitSha: manifest.commitSha,
      rightsNote: manifest.rightsNote,
      importedAt: manifest.importedAt,
    });
  }

  return {
    item: {
      ...toSummary(row),
      entryRaw: row.entryRaw,
      sourcePdfPage: row.sourcePdfPage,
      definition: row.definition,
      // A definition is never shown without saying where it came from.
      definitionProvenance: row.definition ? row.definitionProvenance : null,
    },
    edition: {
      id: edition.id,
      publisher: edition.publisher,
      editionDate: edition.editionDate,
      synthetic: getEdition(edition.id)?.synthetic ?? false,
      isActive: edition.isActive,
    },
    homographs: homographs.map(toSummary),
    sources,
    progress: null,
  };
}
