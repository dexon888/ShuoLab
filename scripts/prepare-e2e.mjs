// Prepares the browser tests: one production build and local databases of
// their own, so the tests never depend on (or disturb) the dev database.
//   .wrangler/e2e-state         empty: nothing imported
//   .wrangler/e2e-seeded        synthetic placeholder vocabulary (not HSK content)
//   .wrangler/e2e-flow-desktop  the same placeholder vocabulary, for the
//   .wrangler/e2e-flow-mobile   whole-session tests: a day has one session, so
//                               each screen size gets a database to itself
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The Cloudflare plugin copies the project's .dev.vars into the build, and
// the preview servers read it from there. If the owner has put a real
// provider key in .dev.vars, the tests would call the real provider and be
// billed. Replace it with test-only values: stand-in providers, local
// sign-in bypass, nothing else.
const builtVars = join(root, "dist", "shuolab", ".dev.vars");
writeFileSync(builtVars, "APP_ENV=development\nDEV_AUTH_BYPASS=true\n");
const leaked = readFileSync(builtVars, "utf8").match(/^(OPENAI_API_KEY|AZURE_SPEECH_KEY)\s*=/m);
if (leaked) {
  console.error(`Refusing to run the browser tests: ${leaked[1]} is in the test build.`);
  process.exit(1);
}
console.log("Test build uses stand-in providers only (provider keys removed from dist/shuolab/.dev.vars).");
