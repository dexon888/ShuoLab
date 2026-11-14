/**
 * Database access for command-line scripts.
 *
 * Local:  the same on-disk D1 that `pnpm dev` uses, opened through Wrangler.
 * Remote: the deployed D1, reached by running the Wrangler CLI (needs
 *         `wrangler login`). Remote access has not been exercised yet.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import type { QueryFn } from "../../src/server/services/curriculum-import";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG_PATH = join(ROOT, "wrangler.jsonc");
const DATABASE_NAME = "shuolab";
const DEFAULT_STATE_DIR = join(ROOT, ".wrangler", "state");

export interface LocalDatabase {
  db: D1Database;
  query: QueryFn;
  dispose: () => Promise<void>;
}

/** `stateDir` is the directory passed to Wrangler's `--persist-to` (default `.wrangler/state`). */
export async function openLocalDatabase(stateDir?: string): Promise<LocalDatabase> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: CONFIG_PATH,
    // Wrangler stores local data in a `v3` folder inside the state directory.
    persist: { path: join(stateDir ? resolve(stateDir) : DEFAULT_STATE_DIR, "v3") },
  });
  const db = proxy.env.DB;
  return {
    db,
    query: async (sql) => (await db.prepare(sql).all<Record<string, unknown>>()).results,
    dispose: () => proxy.dispose(),
  };
}

/** True when the migrations have been applied to this database. */
export async function hasCurriculumTables(query: QueryFn): Promise<boolean> {
  const rows = await query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('curriculum_items', 'curriculum_editions', 'source_manifests')",
  );
  return rows.length === 3;
}

function runWrangler(args: string[]): { status: number; stdout: string; stderr: string } {
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const remoteQuery: QueryFn = async (sql) => {
  const result = runWrangler([
    "d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sql.replace(/\s+/g, " "),
  ]);
  if (result.status !== 0) {
    throw new Error(`Remote query failed. Is \`wrangler login\` done and the database created?\n${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { results?: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
};

/** Executes a SQL script against the deployed database, then deletes the script. */
export function executeRemoteScript(script: string): void {
  // Kept inside .wrangler/ (git-ignored): the script contains syllabus data.
  const dir = join(ROOT, ".wrangler", "tmp");
  const file = join(dir, `curriculum-import-${Date.now()}.sql`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, script, "utf8");
  try {
    const result = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--yes", "--file", file]);
    if (result.status !== 0) {
      throw new Error(`Remote import failed; D1 rolls back a failed file import.\n${result.stderr || result.stdout}`);
    }
  } finally {
    rmSync(file, { force: true });
  }
}
