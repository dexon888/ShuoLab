// Pre-deploy safety checks (SPEC §4.1): refuses to deploy a configuration that
// would weaken authentication or point at a placeholder database.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";

/** Strips // and /* *\/ comments that are outside string literals. */
export function stripJsonComments(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) break;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Returns a list of human-readable problems; empty means safe to deploy. */
export function findDeployProblems(config) {
  const problems = [];
  const vars = config.vars ?? {};

  if ("DEV_AUTH_BYPASS" in vars) {
    problems.push("wrangler.jsonc sets DEV_AUTH_BYPASS. Remove it: the bypass is for local development only.");
  }
  if (vars.APP_ENV !== "production") {
    problems.push('wrangler.jsonc must set vars.APP_ENV to "production".');
  }
  for (const name of ["OPENAI_API_KEY", "AZURE_SPEECH_KEY"]) {
    if (name in vars) {
      problems.push(`wrangler.jsonc contains ${name} in plain text. Use \`wrangler secret put ${name}\` instead.`);
    }
  }
  const db = (config.d1_databases ?? []).find((d) => d.binding === "DB");
  if (!db) {
    problems.push("wrangler.jsonc has no D1 binding named DB.");
  } else if (!db.database_id || db.database_id === PLACEHOLDER_DB_ID) {
    problems.push("wrangler.jsonc still has the placeholder D1 database_id. Run `wrangler d1 create shuolab` and paste the id (see README).");
  }
  if (config.preview_urls !== false) {
    problems.push("wrangler.jsonc must keep preview_urls set to false so no unprotected hostname exists.");
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
  const config = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
  const problems = findDeployProblems(config);
  if (problems.length > 0) {
    console.error("Deploy blocked:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("Deploy configuration checks passed.");
}
