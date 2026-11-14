import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { D1Database } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../src/server/db/migrations/", import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));

export interface TestDatabase {
  db: D1Database;
  dispose: () => Promise<void>;
}

/**
 * A real, empty, in-memory D1 database (the workerd SQLite engine Wrangler runs
 * locally, nothing persisted) with every migration applied in order — the same
 * SQL files Wrangler applies in production.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: CONFIG_PATH,
    persist: false,
  });
  const db = proxy.env.DB;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const statements = readFileSync(MIGRATIONS_DIR + file, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
  }

  return { db, dispose: () => proxy.dispose() };
}
