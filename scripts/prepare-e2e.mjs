// Prepares the browser tests: one production build and local databases of
// their own, so the tests never depend on (or disturb) the dev database.
//   .wrangler/e2e-state         empty: nothing imported
//   .wrangler/e2e-seeded        synthetic placeholder vocabulary (not HSK content)
//   .wrangler/e2e-flow-desktop  the same placeholder vocabulary, for the
//   .wrangler/e2e-flow-mobile   whole-session tests: a day has one session, so
//                               each screen size gets a database to itself
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const EMPTY_STATE_DIR = join(root, ".wrangler", "e2e-state");
const SEEDED_STATE_DIRS = ["e2e-seeded", "e2e-flow-desktop", "e2e-flow-mobile"].map((name) => join(root, ".wrangler", name));

const require = createRequire(import.meta.url);
const bin = (pkg, file) => join(dirname(require.resolve(`${pkg}/package.json`)), file);
const wrangler = bin("wrangler", "bin/wrangler.js");
const tsx = bin("tsx", "dist/cli.mjs");
const vite = bin("vite", "bin/vite.js");

function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(join(root, "scripts", "ensure-dev-vars.mjs"), []);

for (const dir of [EMPTY_STATE_DIR, ...SEEDED_STATE_DIRS]) {
  rmSync(dir, { recursive: true, force: true });
  run(wrangler, ["d1", "migrations", "apply", "shuolab", "--local", "--persist-to", dir]);
}
for (const dir of SEEDED_STATE_DIRS) {
  run(tsx, [join(root, "scripts", "seed-dev-fixtures.ts"), "--persist-to", dir]);
}

// Every preview server serves this one build.
run(vite, ["build"]);
