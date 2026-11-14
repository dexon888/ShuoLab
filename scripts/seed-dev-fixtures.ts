/**
 * Loads SYNTHETIC placeholder vocabulary and colloquial rows into the LOCAL database so the app
 * can be developed without the copyrighted source files. The rows are
 * generated ("样例词 1" …), stored under the `synthetic-fixture` edition, and
 * labelled as synthetic everywhere they appear. Never runs against the
 * deployed database.
 *
 *   pnpm seed:dev [--persist-to <dir>] [--force]
 */
import { parseArgs } from "node:util";
import {
  applyStatements,
  prepareVocabImport,
  verifyDatabase,
} from "../src/server/services/curriculum-import";
import { prepareColloquialImport } from "../src/server/services/colloquial-import";
import { COLLOQUIAL_SOURCES, SYNTHETIC_COLLOQUIAL_SOURCE_KEY } from "../src/shared/colloquial";
import { SYNTHETIC_EDITION_ID, getEdition } from "../src/shared/curriculum";
import { colloquialToCsv, makeSyntheticColloquial } from "../test/fixtures/synthetic-colloquial";
import { makeSyntheticRecords, toCsv } from "../test/fixtures/synthetic-vocab";
import { hasCurriculumTables, openLocalDatabase } from "./lib/d1";
import { printIssues, printSummary, printVerifyReport, sha256Hex } from "./lib/report";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "persist-to": { type: "string" },
      force: { type: "boolean", default: false },
    },
  });

  const bytes = new TextEncoder().encode(toCsv(makeSyntheticRecords()));
  const result = prepareVocabImport({
    editionId: SYNTHETIC_EDITION_ID,
    files: [{ name: "synthetic-vocab.csv", bytes, sha256: sha256Hex(bytes) }],
    source: {
      sourceUrl: "generated:shuolab/test/fixtures/synthetic-vocab.ts",
      commitSha: null,
      rightsNote: "Generated placeholder rows. Not HSK content.",
    },
    importedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    printIssues(result.issues);
    return 1;
  }

  // Placeholder colloquial rows, stored under their own synthetic source.
  const colloquialSource = COLLOQUIAL_SOURCES[SYNTHETIC_COLLOQUIAL_SOURCE_KEY];
  if (!colloquialSource) throw new Error("Synthetic colloquial source missing.");
  const colloquialBytes = new TextEncoder().encode(colloquialToCsv(makeSyntheticColloquial()));
  const colloquial = prepareColloquialImport({
    source: colloquialSource,
    file: { name: "synthetic-colloquial.csv", bytes: colloquialBytes, sha256: sha256Hex(colloquialBytes) },
    importedAt: new Date().toISOString(),
    datasetVersion: "synthetic",
  });
  if (!colloquial.ok) {
    console.error(colloquial.issues);
    return 1;
  }

  const local = await openLocalDatabase(values["persist-to"]);
  try {
    if (!(await hasCurriculumTables(local.query))) {
      console.error("The local database has no tables yet. Run `pnpm db:migrate:local` first.");
      return 1;
    }
    const active = await local.query("SELECT id FROM curriculum_editions WHERE is_active = 1");
    const realEdition = active.map((r) => String(r.id)).find((id) => !getEdition(id)?.synthetic);
    if (realEdition && !values.force) {
      console.error(
        `Edition ${realEdition} is active in this database. Seeding would make the synthetic edition active instead. Re-run with --force if that is what you want.`,
      );
      return 1;
    }
    printSummary(result.summary);
    await applyStatements(local.db, result.statements);
    await applyStatements(local.db, colloquial.statements);
    console.log(`Loaded ${colloquial.summary.total} SYNTHETIC colloquial placeholder rows (not real expressions).`);
    printVerifyReport(await verifyDatabase(local.query));
    return 0;
  } finally {
    await local.dispose();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
