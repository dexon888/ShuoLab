import type { D1Database } from "@cloudflare/workers-types";
import { and, asc, count, eq, gt, max, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { ColloquialExpression, ColloquialQuery, ColloquialResponse } from "../../shared/api";
import {
  getColloquialSource,
  isColloquialId,
  type ColloquialChannel,
  type ColloquialRegister,
  type CurrencyStatus,
} from "../../shared/colloquial";
import { colloquialExpressions } from "../db/schema";
import { ApiError } from "../validation/errors";

type Row = typeof colloquialExpressions.$inferSelect;

function toExpression(row: Row): ColloquialExpression {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    term: row.term,
    pinyin: row.pinyin,
    meaningEn: row.meaningEn,
    literalEn: row.literalEn,
    category: row.category,
    // CHECK constraints guarantee these values.
    register: row.register as ColloquialRegister,
    channel: row.channel as ColloquialChannel,
    region: row.region,
    currencyStatus: row.currencyStatus as CurrencyStatus,
    inUseSince: row.inUseSince,
    lastVerifiedAt: row.lastVerifiedAt,
    sourceUrl: row.sourceUrl,
    verificationStatus: row.verificationStatus === "verified" ? "verified" : "unverified",
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * One page of colloquial expressions, with the sources to credit. This reads
 * only `colloquial_expressions`; HSK counts never read that table.
 */
export async function listColloquial(d1: D1Database, query: ColloquialQuery): Promise<ColloquialResponse> {
  const db = drizzle(d1);
  const t = colloquialExpressions;

  // The cursor is the id of the last row of the previous page.
  if (query.cursor !== undefined && !isColloquialId(query.cursor)) {
    throw new ApiError("BAD_REQUEST", 'Invalid "cursor" parameter.');
  }

  const filters: SQL[] = [];
  if (query.register) filters.push(eq(t.register, query.register));
  if (query.channel) filters.push(eq(t.channel, query.channel));
  if (query.status) filters.push(eq(t.currencyStatus, query.status));
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    filters.push(
      sql`(${t.term} LIKE ${pattern} ESCAPE '\\' OR ${t.pinyin} LIKE ${pattern} ESCAPE '\\' OR ${t.meaningEn} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, totals, sourceRows] = await Promise.all([
    db
      .select()
      .from(t)
      .where(query.cursor ? and(where, gt(t.id, query.cursor)) : where)
      .orderBy(asc(t.id))
      .limit(query.limit + 1),
    db.select({ n: count() }).from(t).where(where),
    db
      .select({
        key: t.sourceKey,
        n: count(),
        datasetVersion: max(t.datasetVersion),
        importedAt: max(t.importedAt),
        license: max(t.license),
        attribution: max(t.attribution),
      })
      .from(t)
      .groupBy(t.sourceKey)
      .orderBy(asc(t.sourceKey)),
  ]);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    items: page.map(toExpression),
    total: totals[0]?.n ?? 0,
    nextCursor: rows.length > query.limit && last ? last.id : null,
    sources: sourceRows.map((row) => {
      const known = getColloquialSource(row.key);
      return {
        key: row.key,
        name: known?.name ?? row.key,
        homepage: known?.homepage ?? null,
        // The licence and credit stored with the rows are what was imported.
        license: row.license ?? known?.license ?? "Unknown",
        licenseUrl: known?.licenseUrl ?? null,
        attribution: row.attribution ?? known?.attribution ?? row.key,
        synthetic: known?.synthetic ?? false,
        count: row.n,
        datasetVersion: row.datasetVersion,
        importedAt: row.importedAt,
      };
    }),
  };
}
