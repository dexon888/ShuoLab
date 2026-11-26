/**
 * Loads a ShuoLab export into the LOCAL database (FR-019, SEC-05).
 *
 *   pnpm data:import --file ./private-data/shuolab-export-2026-11-26.json
 *
 * Only into a local database that holds none of your data yet, and only
 * after the same curriculum edition has been imported. It never writes to
 * the deployed database: that is deliberate, so a mistyped command cannot
 * overwrite your real history.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { importOwnerData } from "../src/server/services/owner-data";
import { ApiError } from "../src/server/validation/errors";
import { openLocalDatabase } from "./lib/d1";

const USAGE = `Usage:
  pnpm data:import --file <export.json> [--persist-to <dir>]

  --file <path>       A JSON export from Settings → Your data
  --persist-to <dir>  Local Wrangler state directory (default .wrangler/state)

Local only. Run "pnpm db:migrate:local" and the curriculum import first.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { file: { type: "string" }, "persist-to": { type: "string" }, remote: { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.remote) {
    console.error("Importing into the deployed database is not supported. This tool is for local testing and recovery.");
    return 2;
  }
  if (!values.file) {
    console.error(USAGE);
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(resolve(values.file), "utf8"));
  } catch {
    console.error(`Could not read ${values.file} as JSON.`);
    return 1;
  }

  const local = await openLocalDatabase(values["persist-to"]);
  try {
    const { inserted } = await importOwnerData(local.db, input);
    console.log("Imported into the local database:");
    for (const [table, n] of Object.entries(inserted)) console.log(`  ${table.padEnd(22)} ${n}`);
    return 0;
  } catch (error) {
    console.error(error instanceof ApiError ? error.message : "The import failed; nothing was written.");
    return 1;
  } finally {
    await local.dispose();
  }
}

process.exit(await main());
