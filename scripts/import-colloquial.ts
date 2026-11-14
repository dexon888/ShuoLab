/**
 * Imports the HearMandarin colloquial-expression dataset (SPEC §2.3) from a
 * file the owner downloaded. Nothing is fetched from the network.
 *
 *   pnpm colloquial:import --file ./private-data/colloquial/chinese-slang.json
 *
 * The file is validated in full before anything is written. These rows are a
 * separate track and are never part of an HSK count.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyStatements, renderSqlScript } from "../src/server/services/curriculum-import";
import { prepareColloquialImport } from "../src/server/services/colloquial-import";
import { COLLOQUIAL_SOURCES, HEARMANDARIN_SOURCE_KEY } from "../src/shared/colloquial";
import { executeRemoteScript, openLocalDatabase, remoteQuery } from "./lib/d1";
import { sha256Hex } from "./lib/report";

const USAGE = `Usage:
  pnpm colloquial:import --file <path> [options]

Required:
  --file <path>         The downloaded chinese-slang.json or chinese-slang.csv

Options:
  --dataset-version <v> Version shown on the dataset page (only needed for CSV; JSON carries it)
  --dry-run             Validate and report only; write nothing
  --remote              Import into the deployed database instead of the local one
  --persist-to <dir>    Local Wrangler state directory (default .wrangler/state)
`;

const COUNT_SQL = "SELECT COUNT(*) AS n FROM colloquial_expressions WHERE source_key = 'hearmandarin'";
const TABLE_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'colloquial_expressions'";

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([key, n]) => `${key}=${n}`)
    .join("  ");
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      "dataset-version": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      "persist-to": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.file) fail("Missing --file.");
  const path = resolve(values.file);
  if (!existsSync(path) || !statSync(path).isFile()) fail(`File not found: ${path}`);
  if (!/\.(csv|json)$/i.test(path)) fail("The file must be .csv or .json.");

  const source = COLLOQUIAL_SOURCES[HEARMANDARIN_SOURCE_KEY];
  if (!source) throw new Error("Source definition missing.");
  const bytes = readFileSync(path);
  const result = prepareColloquialImport({
    source,
    file: { name: basename(path), bytes, sha256: sha256Hex(bytes) },
    importedAt: new Date().toISOString(),
    datasetVersion: values["dataset-version"] ?? null,
  });

  if (!result.ok) {
    console.error(`\nImport rejected: ${result.issues.length} problem(s). Nothing was written.\n`);
    for (const issue of result.issues.slice(0, 40)) {
      console.error(`  [${issue.code}] ${issue.position ? `${basename(path)}:${issue.position}  ` : ""}${issue.message}`);
    }
    if (result.issues.length > 40) console.error(`  … and ${result.issues.length - 40} more.`);
    return 1;
  }

  const { summary } = result;
  console.log(`${source.name}: ${summary.total} expressions validated (dataset version ${summary.datasetVersion ?? "not stated"}).`);
  console.log(`  Register: ${formatCounts(summary.byRegister)}`);
  console.log(`  Channel:  ${formatCounts(summary.byChannel)}`);
  console.log(`  Status:   ${formatCounts(summary.byStatus)}`);
  console.log(`  ${summary.file.sha256}  ${summary.file.name}`);
  console.log(`  Licence: ${source.license}. Credit: ${source.attribution}`);
  console.log("  Separate from HSK: these are never part of an HSK count.");

  if (values["dry-run"]) {
    console.log("\nDry run: validation passed, nothing was written.");
    return 0;
  }

  if (values.remote) {
    console.log("\nImporting into the deployed database…");
    executeRemoteScript(renderSqlScript(result.statements));
    const rows = await remoteQuery(COUNT_SQL);
    console.log(`Stored: ${String(rows[0]?.n ?? "?")} expressions from ${source.name}.`);
    return 0;
  }

  const local = await openLocalDatabase(values["persist-to"]);
  try {
    if ((await local.query(TABLE_SQL)).length === 0) {
      console.error("\nThe local database is missing the colloquial table. Run `pnpm db:migrate:local` first.");
      return 1;
    }
    console.log("\nImporting into the local database…");
    await applyStatements(local.db, result.statements);
    const rows = await local.query(COUNT_SQL);
    console.log(`Stored: ${String(rows[0]?.n ?? "?")} expressions from ${source.name}.`);
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
