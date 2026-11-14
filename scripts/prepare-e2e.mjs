// Gives the browser tests their own empty local database, so they never
// depend on (or disturb) whatever has been imported into the dev database.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const E2E_STATE_DIR = join(root, ".wrangler", "e2e-state");

const require = createRequire(import.meta.url);
const run = (file, args) => spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: "inherit" });

if (run(join(root, "scripts", "ensure-dev-vars.mjs"), []).status !== 0) process.exit(1);

rmSync(E2E_STATE_DIR, { recursive: true, force: true });

const wrangler = join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
const migrate = run(wrangler, ["d1", "migrations", "apply", "shuolab", "--local", "--persist-to", E2E_STATE_DIR]);
process.exit(migrate.status ?? 1);
