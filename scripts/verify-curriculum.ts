/**
 * Checks what is stored in the curriculum tables against the active
 * edition's published totals. Exits non-zero unless everything passes.
 *
 *   pnpm curriculum:verify [--remote] [--persist-to <dir>]
 */
import { parseArgs } from "node:util";
import { verifyDatabase } from "../src/server/services/curriculum-import";
import { hasCurriculumTables, openLocalDatabase, remoteQuery } from "./lib/d1";
import { printVerifyReport } from "./lib/report";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      remote: { type: "boolean", default: false },
      "persist-to": { type: "string" },
    },
  });

  if (values.remote) {
    const report = await verifyDatabase(remoteQuery);
    printVerifyReport(report);
    return report.ok ? 0 : 1;
  }

  const local = await openLocalDatabase(values["persist-to"]);
  try {
    if (!(await hasCurriculumTables(local.query))) {
      console.error("The local database has no tables yet. Run `pnpm db:migrate:local` first.");
      return 1;
    }
    const report = await verifyDatabase(local.query);
    printVerifyReport(report);
    return report.ok ? 0 : 1;
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
