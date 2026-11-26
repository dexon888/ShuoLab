/**
 * Imports the HSK grammar, character, topic and task lists (SPEC §2.2 #1, #8).
 *
 *   pnpm curriculum:import-sections --source ./private-data/hsk-sections \
 *     --commit <40-character source commit>
 *
 * Needs the vocabulary imported and verified first: the source's own
 * vocabulary list must match it entry for entry. Everything is checked before
 * anything is written, and the rows are stored as unverified, so they never
 * count toward verified HSK coverage. See README "Grammar, characters, topics
 * and tasks".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  applyStatements,
  prepareSectionsImport,
  renderSqlScript,
  verifyDatabase,
  SECTION_TYPES,
  type QueryFn,
  type SourceFile,
  type StoredVocab,
} from "../src/server/services/curriculum-import";
import { HSK_BANDS } from "../src/shared/curriculum";
import { executeRemoteScript, hasCurriculumTables, openLocalDatabase, remoteQuery } from "./lib/d1";
import { sha256Hex } from "./lib/report";

export const SECTIONS_SOURCE = {
  url: "https://github.com/profesorm/hsk30",
  rightsNote:
    "HSK 3.0 2026 Syllabus Dataset by profesorm, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). A second-hand transcription of the syllabus published by Chinese Testing International; not checked against the official document. ShuoLab stores it unchanged except for splitting example sentences.",
};

const USAGE = `Usage:
  pnpm curriculum:import-sections --source <dir> --commit <sha> [options]

Required:
  --source <dir>      Directory holding hsk_grammar.csv, hsk_hanzi.csv, hsk_topic.csv,
                      hsk_task.csv and hsk_vocabulary.csv
  --commit <sha>      Full 40-character commit of the source repository

Options:
  --dry-run           Check and report only; write nothing
  --remote            Import into the deployed database instead of the local one
  --persist-to <dir>  Local Wrangler state directory (default .wrangler/state)
`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

async function storedVocab(query: QueryFn, editionId: string): Promise<StoredVocab[]> {
  const rows = await query(
    `SELECT source_id, hanzi, pinyin FROM curriculum_items WHERE edition_id = '${editionId.replaceAll("'", "''")}' AND item_type = 'vocab' ORDER BY source_id`,
  );
  return rows.map((r) => ({ sourceId: Number(r.source_id), hanzi: String(r.hanzi), pinyin: r.pinyin == null ? null : String(r.pinyin) }));
}

async function run(query: QueryFn, write: (statements: Parameters<typeof renderSqlScript>[0]) => Promise<void>, files: SourceFile[], commit: string, dryRun: boolean): Promise<number> {
  const before = await verifyDatabase(query);
  if (!before.ok || !before.editionId || before.synthetic) {
    console.error("\nThe active edition's vocabulary is not imported and verified. Run `pnpm curriculum:import` first.");
    return 1;
  }
  const result = prepareSectionsImport({
    editionId: before.editionId,
    files,
    storedVocab: await storedVocab(query, before.editionId),
    source: { sourceUrl: SECTIONS_SOURCE.url, commitSha: commit, rightsNote: SECTIONS_SOURCE.rightsNote },
    importedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    console.error(`\nImport rejected: ${result.issues.length} problem(s). Nothing was written.\n`);
    for (const issue of result.issues.slice(0, 40)) {
      const where = [issue.file, issue.line ? `line ${issue.line}` : ""].filter(Boolean).join(" ");
      console.error(`  ${issue.code}${where ? ` (${where})` : ""}: ${issue.message}`);
    }
    if (result.issues.length > 40) console.error(`  … and ${result.issues.length - 40} more.`);
    return 1;
  }

  const { summary } = result;
  console.log(`Edition ${summary.editionId}: the source's vocabulary matches all ${summary.vocabularyMatched} stored entries.`);
  console.log(`  ${"".padEnd(10)}${HSK_BANDS.map((b) => b.padStart(6)).join("")}  total`);
  for (const type of SECTION_TYPES) {
    const c = summary.counts[type];
    const total = HSK_BANDS.reduce((n, b) => n + c[b], 0);
    console.log(`  ${type.padEnd(10)}${HSK_BANDS.map((b) => String(c[b]).padStart(6)).join("")}  ${total}`);
  }
  for (const f of summary.files) console.log(`  ${f.sha256}  ${f.name}`);
  console.log("\nStored as unverified: these sections are not counted as verified HSK coverage.");

  if (dryRun) {
    console.log("\nDry run: checks passed, nothing was written.");
    return 0;
  }
  await write(result.statements);
  const after = await verifyDatabase(query);
  console.log("\nSections now stored:");
  for (const d of after.dimensions) console.log(`  ${d.itemType.padEnd(10)} ${d.status} (${d.count} rows)`);
  return after.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      commit: { type: "string" },
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
  if (!values.source) fail("Missing --source.");
  const commit = values.commit?.trim().toLowerCase();
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) fail("Missing or invalid --commit (the full 40-character source commit).");
  const dir = resolve(values.source);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`Source directory not found: ${dir}`);

  const files: SourceFile[] = readdirSync(dir)
    .filter((name) => /\.csv$/i.test(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { name, bytes, sha256: sha256Hex(bytes) };
    });
  const dryRun = values["dry-run"] ?? false;

  if (values.remote) {
    return run(remoteQuery, async (s) => executeRemoteScript(renderSqlScript(s)), files, commit, dryRun);
  }
  const local = await openLocalDatabase(values["persist-to"]);
  try {
    if (!(await hasCurriculumTables(local.query))) {
      console.error("\nThe local database has no tables yet. Run `pnpm db:migrate:local` first.");
      return 1;
    }
    return await run(local.query, (s) => applyStatements(local.db, s), files, commit, dryRun);
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
