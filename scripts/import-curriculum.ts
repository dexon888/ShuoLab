/**
 * Imports owner-provided HSK vocabulary files (SPEC §2.2).
 *
 *   pnpm curriculum:import --source ./private-data/hsk-vocab \
 *     --edition hsk3-2025-11 --commit <40-character source commit>
 *
 * The files are validated in full before anything is written; a single
 * problem rejects the whole import. See README "Importing the HSK vocabulary".
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  applyStatements,
  prepareVocabImport,
  renderSqlScript,
  verifyDatabase,
  type SourceFile,
} from "../src/server/services/curriculum-import";
import { ACTIVE_EDITION_ID, getEdition } from "../src/shared/curriculum";
import {
  executeRemoteScript,
  hasCurriculumTables,
  openLocalDatabase,
  remoteQuery,
} from "./lib/d1";
import { printIssues, printSummary, printVerifyReport, sha256Hex } from "./lib/report";

const DEFAULT_SOURCES: Record<string, { url: string; rightsNote: string }> = {
  [ACTIVE_EDITION_ID]: {
    url: "https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset",
    rightsNote:
      "Independent transcription of the November 2025 HSK syllabus vocabulary. Syllabus content belongs to its publisher; the transcription states no licence for the data. Imported locally by the owner for personal use; not redistributed.",
  },
};

const USAGE = `Usage:
  pnpm curriculum:import --source <dir> --edition <id> --commit <sha> [options]

Required:
  --source <dir>      Directory holding the vocabulary .csv or .json files
  --edition <id>      Edition id, e.g. ${ACTIVE_EDITION_ID}
  --commit <sha>      Full 40-character commit of the source repository the files came from

Options:
  --source-url <url>  Where the files came from (default: the known source for the edition)
  --rights-note <t>   Rights note stored with the import
  --dry-run           Validate and report only; write nothing
  --report <file>     Also write the validation result as JSON
  --remote            Import into the deployed database instead of the local one
  --persist-to <dir>  Local Wrangler state directory (default .wrangler/state)
`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      edition: { type: "string" },
      commit: { type: "string" },
      "source-url": { type: "string" },
      "rights-note": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      report: { type: "string" },
      remote: { type: "boolean", default: false },
      "persist-to": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.source) fail("Missing --source.");
  if (!values.edition) fail("Missing --edition.");

  const edition = getEdition(values.edition);
  if (!edition) fail(`Unknown edition "${values.edition}".`);
  if (edition.synthetic) {
    fail("The synthetic edition is loaded with `pnpm seed:dev`, not with curriculum:import.");
  }

  const commit = values.commit?.trim().toLowerCase();
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    fail(
      "Missing or invalid --commit. Pin the exact source commit the files came from: run `git rev-parse HEAD` in your clone of the source repository, or `git ls-remote <repository-url> HEAD` when you download.",
    );
  }

  const defaults = DEFAULT_SOURCES[edition.id];
  const sourceUrl = values["source-url"] ?? defaults?.url;
  const rightsNote = values["rights-note"] ?? defaults?.rightsNote;
  if (!sourceUrl || !rightsNote) fail("Missing --source-url or --rights-note for this edition.");

  const dir = resolve(values.source);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`Source directory not found: ${dir}`);
  }
  const files: SourceFile[] = readdirSync(dir)
    .filter((name) => /\.(csv|json)$/i.test(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { name, bytes, sha256: sha256Hex(bytes) };
    });

  const result = prepareVocabImport({
    editionId: edition.id,
    files,
    source: { sourceUrl, commitSha: commit, rightsNote },
    importedAt: new Date().toISOString(),
  });

  if (values.report) {
    const report = result.ok ? { ok: true, summary: result.summary } : { ok: false, issues: result.issues };
    writeFileSync(resolve(values.report), JSON.stringify(report, null, 2), "utf8");
  }

  if (!result.ok) {
    printIssues(result.issues);
    return 1;
  }
  printSummary(result.summary);

  if (values["dry-run"]) {
    console.log("\nDry run: validation passed, nothing was written.");
    return 0;
  }

  if (values.remote) {
    console.log("\nImporting into the deployed database…");
    executeRemoteScript(renderSqlScript(result.statements));
    const report = await verifyDatabase(remoteQuery);
    printVerifyReport(report);
    return report.ok ? 0 : 1;
  }

  const local = await openLocalDatabase(values["persist-to"]);
  try {
    if (!(await hasCurriculumTables(local.query))) {
      console.error("\nThe local database has no tables yet. Run `pnpm db:migrate:local` first.");
      return 1;
    }
    console.log("\nImporting into the local database…");
    await applyStatements(local.db, result.statements);
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
