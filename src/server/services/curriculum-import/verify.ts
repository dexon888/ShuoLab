import {
  HSK_BANDS,
  ITEM_TYPES,
  getEdition,
  type ItemType,
} from "../../../shared/curriculum";

/** Runs a read-only query and returns its rows. Lets the same checks run locally or remotely. */
export type QueryFn = (sql: string) => Promise<Record<string, unknown>[]>;

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  editionId: string | null;
  synthetic: boolean;
  checks: VerifyCheck[];
  /** Import state of each syllabus section (SPEC §2.2 #8). */
  dimensions: { itemType: ItemType; status: "missing" | "imported" | "verified"; count: number }[];
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Integrity checks on what is actually stored, independent of the import
 * that put it there. `ok` is true only when the active edition's vocabulary
 * is complete, correctly identified and backed by a verified manifest.
 */
export async function verifyDatabase(query: QueryFn): Promise<VerifyReport> {
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const editions = await query(
    "SELECT id FROM curriculum_editions WHERE is_active = 1 ORDER BY id",
  );
  const editionId = editions.length === 1 ? String(editions[0]?.id) : null;
  const edition = editionId ? getEdition(editionId) : undefined;

  add(
    "One active edition",
    editions.length === 1,
    editions.length === 0
      ? "No edition is active: nothing has been imported."
      : editions.length === 1
        ? `Active edition is ${editionId}.`
        : `${editions.length} editions are marked active.`,
  );

  const emptyDimensions = ITEM_TYPES.map((itemType) => ({
    itemType,
    status: "missing" as const,
    count: 0,
  }));
  if (!editionId) {
    return { ok: false, editionId: null, synthetic: false, checks, dimensions: emptyDimensions };
  }

  add(
    "Edition is known",
    edition !== undefined,
    edition ? `${edition.publisher}, ${edition.editionDate}.` : `No published totals are known for ${editionId}.`,
  );
  if (!edition) {
    return { ok: false, editionId, synthetic: false, checks, dimensions: emptyDimensions };
  }

  const e = quote(editionId);
  const vocab = `edition_id = ${e} AND item_type = 'vocab'`;

  const [range] = await query(
    `SELECT COUNT(*) AS n, MIN(source_id) AS lo, MAX(source_id) AS hi FROM curriculum_items WHERE ${vocab}`,
  );
  const total = num(range?.n);
  const expectedTotal = edition.vocabTotalEntries;
  // source_id is unique per edition and type, so count + min + max proves full coverage.
  const complete = total === expectedTotal && num(range?.lo) === 1 && num(range?.hi) === expectedTotal;
  add(
    `Numbered entries 1–${expectedTotal} are all present`,
    complete,
    total === 0
      ? "No vocabulary rows are stored."
      : `${total} rows, ids ${num(range?.lo)}–${num(range?.hi)}.`,
  );

  const bandRows = await query(
    `SELECT hsk_band AS band, COUNT(*) AS n FROM curriculum_items WHERE ${vocab} GROUP BY hsk_band`,
  );
  const perBand = new Map(bandRows.map((r) => [String(r.band), num(r.n)]));
  const bandProblems = HSK_BANDS.filter(
    (band) => (perBand.get(band) ?? 0) !== edition.vocabNewEntriesByBand[band],
  ).map((band) => `HSK ${band}: ${perBand.get(band) ?? 0} of ${edition.vocabNewEntriesByBand[band]}`);
  add(
    "Each band has the published number of new entries",
    bandProblems.length === 0,
    bandProblems.length === 0
      ? HSK_BANDS.map((band) => `${band}: ${perBand.get(band) ?? 0}`).join(", ")
      : bandProblems.join("; "),
  );

  const [badIds] = await query(
    `SELECT COUNT(*) AS n FROM curriculum_items WHERE ${vocab} AND id <> edition_id || ':vocab:' || source_id`,
  );
  add(
    "Item ids match edition:vocab:sourceId",
    num(badIds?.n) === 0,
    num(badIds?.n) === 0 ? "All ids are well formed." : `${num(badIds?.n)} rows have a mismatched id.`,
  );

  const [incomplete] = await query(
    `SELECT COUNT(*) AS n FROM curriculum_items WHERE ${vocab} AND (
       hanzi = '' OR pinyin IS NULL OR pinyin = '' OR entry_raw IS NULL OR entry_raw = ''
       OR level_label IS NULL OR level_label = '' OR source_pdf_page IS NULL)`,
  );
  add(
    "Every entry keeps its source fields",
    num(incomplete?.n) === 0,
    num(incomplete?.n) === 0
      ? "hanzi, pinyin, entry, level label and source page are present on every row."
      : `${num(incomplete?.n)} rows are missing a source field.`,
  );

  const [manifests] = await query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(record_count), 0) AS records FROM source_manifests
     WHERE edition_id = ${e} AND dataset_kind = 'vocab' AND verification_status = 'verified'`,
  );
  add(
    "A verified source manifest is recorded",
    num(manifests?.n) > 0,
    num(manifests?.n) > 0
      ? `${num(manifests?.n)} source file(s) recorded with checksums.`
      : "No verified manifest: these rows did not come from a validated import.",
  );

  const [definitions] = await query(
    `SELECT COUNT(*) AS n FROM curriculum_items WHERE ${vocab} AND definition IS NOT NULL
       AND (definition_provenance IS NULL OR definition_provenance = '')`,
  );
  add(
    "No definition lacks provenance",
    num(definitions?.n) === 0,
    num(definitions?.n) === 0
      ? "No unattributed definitions."
      : `${num(definitions?.n)} definitions have no recorded provenance.`,
  );

  const ok = checks.every((c) => c.ok);

  const typeRows = await query(
    `SELECT item_type AS t, COUNT(*) AS n FROM curriculum_items WHERE edition_id = ${e} GROUP BY item_type`,
  );
  const perType = new Map(typeRows.map((r) => [String(r.t), num(r.n)]));
  const dimensions = ITEM_TYPES.map((itemType) => {
    const count = perType.get(itemType) ?? 0;
    const status =
      itemType === "vocab" && ok ? ("verified" as const) : count > 0 ? ("imported" as const) : ("missing" as const);
    return { itemType, status, count };
  });

  return { ok, editionId, synthetic: edition.synthetic, checks, dimensions };
}
