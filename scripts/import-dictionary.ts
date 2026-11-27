/**
 * Imports English meanings for the HSK vocabulary from CC-CEDICT (SPEC §2.6
 * rule 2, FR-033), from a file the owner downloaded and unzipped:
 *
 *   pnpm dictionary:import --file ./private-data/cedict/cedict_ts.u8
 *
 * Nothing is fetched from the network. Meanings go into `definition` with
 * provenance naming the dictionary, never as HSK content. Re-running replaces
 * the meanings with the file's.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyStatements, renderSqlScript, type QueryFn } from "../src/server/services/curriculum-import";
import { glossStatements, matchGlosses, parseCedict, type VocabRow } from "../src/server/services/dictionary";
import { executeRemoteScript, hasCurriculumTables, openLocalDatabase, remoteQuery } from "./lib/d1";
import { sha256Hex } from "./lib/report";

const USAGE = `Usage:
  pnpm dictionary:import --file <cedict_ts.u8> [--dry-run] [--remote] [--persist-to <dir>]
`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

async function run(query: QueryFn, write: (s: ReturnType<typeof glossStatements>) => Promise<void>, text: string, name: string, sha: string, dryRun: boolean) {
  const [edition] = await query("SELECT id FROM curriculum_editions WHERE is_active = 1 LIMIT 1");
  if (!edition) {
    console.error("No active edition. Import the HSK vocabulary first (pnpm curriculum:import).");
    return 1;
  }
  const editionId = String(edition.id);
  const rows = (await query(`SELECT id, hanzi, pinyin FROM curriculum_items WHERE edition_id = '${editionId.replaceAll("'", "''")}' AND item_type = 'vocab'`)) as unknown as VocabRow[];
  const { entries, skipped } = parseCedict(text);
  if (entries.length === 0) {
    console.error("No dictionary entries could be read. Is this the unzipped cedict_ts.u8 file?");
    return 1;
  }
  const match = matchGlosses(rows, entries);
  console.log(`${entries.length} dictionary entries read (${skipped} lines skipped).`);
  console.log(`${rows.length} syllabus entries: ${match.byPinyin} matched by characters and pinyin, ${match.byCharacters} by characters only, ${match.missing} with no meaning.`);
  if (dryRun) {
    console.log("\nDry run: nothing was written.");
    return 0;
  }
  await write(glossStatements(editionId, match.glosses, { name, sha256: sha }, new Date().toISOString()));
  console.log("\nMeanings stored, labelled CC-CEDICT, not HSK.");
  return 0;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { file: { type: "string" }, "dry-run": { type: "boolean", default: false }, remote: { type: "boolean", default: false }, "persist-to": { type: "string" } },
  });
  if (!values.file) fail("Missing --file.");
  const path = resolve(values.file);
  if (!existsSync(path) || !statSync(path).isFile()) fail(`File not found: ${path}`);
  if (/\.zip$/i.test(path)) fail("Unzip the download first and pass the cedict_ts.u8 file inside it.");
  const bytes = readFileSync(path);
  const text = new TextDecoder("utf-8").decode(bytes);
  const name = basename(path);
  const sha = sha256Hex(bytes);
  const dryRun = values["dry-run"] ?? false;
  if (values.remote) return run(remoteQuery, async (s) => executeRemoteScript(renderSqlScript(s)), text, name, sha, dryRun);
  const local = await openLocalDatabase(values["persist-to"]);
  try {
    if (!(await hasCurriculumTables(local.query))) {
      console.error("The local database has no tables yet. Run `pnpm db:migrate:local` first.");
      return 1;
    }
    return await run(local.query, (s) => applyStatements(local.db, s), text, name, sha, dryRun);
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
