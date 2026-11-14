// Creates .dev.vars from .env.example on first run so local mock mode works
// from a clean clone without any secrets. Never overwrites an existing file.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const target = fileURLToPath(new URL(".dev.vars", root));
const example = fileURLToPath(new URL(".env.example", root));

if (existsSync(target)) {
  process.exit(0);
}
copyFileSync(example, target);
console.log("Created .dev.vars from .env.example (local mock mode, no secrets).");
