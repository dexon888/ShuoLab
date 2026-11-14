/**
 * Runs the real command-line scripts as child processes against a throwaway
 * local database. The rows are the synthetic fixture; they are imported under
 * the real edition id only inside this temporary database, to exercise the
 * exact command the owner will run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HSK_BANDS } from "../../src/shared/curriculum";
import { colloquialToJson, makeSyntheticColloquial } from "../fixtures/synthetic-colloquial";
import { makeSyntheticRecords, recordsForBand, toCsv } from "../fixtures/synthetic-vocab";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const TSX = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const WRANGLER = join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

let work: string;
let state: string;
let source: string;

function run(bin: string, args: string[]) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

const script = (name: string, args: string[]) => run(TSX, [join(ROOT, "scripts", name), ...args]);

function writeSource(mutate?: (csv: string) => string) {
  rmSync(source, { recursive: true, force: true });
  mkdirSync(source, { recursive: true });
  const records = makeSyntheticRecords();
  for (const band of HSK_BANDS) {
    const csv = toCsv(recordsForBand(records, band));
    writeFileSync(join(source, `hsk-${band}.csv`), band === "1" && mutate ? mutate(csv) : csv, "utf8");
  }
}

const importArgs = () => ["--source", source, "--edition", "hsk3-2025-11", "--persist-to", state];

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "shuolab-cli-"));
  state = join(work, "state");
  source = join(work, "hsk-vocab");
  const migrate = run(WRANGLER, ["d1", "migrations", "apply", "shuolab", "--local", "--persist-to", state]);
  expect(migrate.code, migrate.out).toBe(0);
}, 120_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("pnpm curriculum:import / curriculum:verify", { timeout: 120_000 }, () => {
  it("reports an empty database as not verified", () => {
    const verify = script("verify-curriculum.ts", ["--persist-to", state]);
    expect(verify.code).toBe(1);
    expect(verify.out).toContain("NOT verified");
  });

  it("requires a pinned 40-character source commit", () => {
    writeSource();
    const missing = script("import-curriculum.ts", importArgs());
    expect(missing.code).toBe(2);
    expect(missing.out).toContain("Missing or invalid --commit");
    const short = script("import-curriculum.ts", [...importArgs(), "--commit", "abc1234"]);
    expect(short.code).toBe(2);
  });

  it("refuses to import the synthetic edition through the real import command", () => {
    const result = script("import-curriculum.ts", [
      "--source", source, "--edition", "synthetic-fixture", "--commit", COMMIT, "--persist-to", state,
    ]);
    expect(result.code).toBe(2);
    expect(result.out).toContain("pnpm seed:dev");
  });

  it("rejects a tampered file with an actionable report and writes nothing (FR-004)", () => {
    // Row 5 claims to be HSK 2 inside the HSK 1 file.
    writeSource((csv) => csv.replace("\n5,1,", "\n5,2,"));
    const reportPath = join(work, "report.json");
    const result = script("import-curriculum.ts", [...importArgs(), "--commit", COMMIT, "--report", reportPath]);

    expect(result.code).toBe(1);
    expect(result.out).toContain("Import rejected");
    expect(result.out).toContain("Nothing was written");
    expect(result.out).toContain("HSK 1: found 299 valid new entries");
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { ok: boolean; issues: { code: string }[] };
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toEqual(["BAND_COUNT_MISMATCH", "BAND_COUNT_MISMATCH"]);

    expect(script("verify-curriculum.ts", ["--persist-to", state]).code).toBe(1);
  });

  it("validates without writing on --dry-run", () => {
    writeSource();
    const result = script("import-curriculum.ts", [...importArgs(), "--commit", COMMIT, "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing was written");
    expect(script("verify-curriculum.ts", ["--persist-to", state]).code).toBe(1);
  });

  it("imports seven per-level files, verifies, and is idempotent (FR-003)", () => {
    writeSource();
    const first = script("import-curriculum.ts", [...importArgs(), "--commit", COMMIT]);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain("11000 numbered entries validated");
    expect(first.out).toContain("1=300  2=200  3=500  4=1000  5=1600  6=1800  7-9=5600");
    expect(first.out).toContain("Verified.");

    const second = script("import-curriculum.ts", [...importArgs(), "--commit", COMMIT]);
    expect(second.code, second.out).toBe(0);

    const verify = script("verify-curriculum.ts", ["--persist-to", state]);
    expect(verify.code, verify.out).toBe(0);
    expect(verify.out).toContain("PASS  Numbered entries 1–11000 are all present — 11000 rows, ids 1–11000.");
    expect(verify.out).toContain("7 source file(s) recorded with checksums");
    expect(verify.out).toMatch(/grammar\s+not imported/);
  });

  it("will not replace a real edition with synthetic data unless forced", () => {
    const seed = script("seed-dev-fixtures.ts", ["--persist-to", state]);
    expect(seed.code).toBe(1);
    expect(seed.out).toContain("Edition hsk3-2025-11 is active");
  });

  it("never leaves an import script behind", () => {
    expect(existsSync(join(ROOT, ".wrangler", "tmp"))).toBe(false);
  });
});

describe("pnpm colloquial:import", { timeout: 120_000 }, () => {
  const file = () => join(work, "chinese-slang.json");
  const count = () => {
    const verify = run(WRANGLER, [
      "d1", "execute", "shuolab", "--local", "--persist-to", state, "--json",
      "--command", "SELECT COUNT(*) AS n FROM colloquial_expressions",
    ]);
    return (JSON.parse(verify.out.slice(verify.out.indexOf("["))) as { results: { n: number }[] }[])[0]?.results[0]?.n;
  };

  it("requires a file", () => {
    const result = script("import-colloquial.ts", ["--persist-to", state]);
    expect(result.code).toBe(2);
    expect(result.out).toContain("Missing --file.");
  });

  it("validates without writing on a dry run", () => {
    writeFileSync(file(), colloquialToJson(makeSyntheticColloquial()), "utf8");
    const result = script("import-colloquial.ts", ["--file", file(), "--persist-to", state, "--dry-run"]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain("12 expressions validated");
    expect(result.out).toContain("nothing was written");
    expect(count()).toBe(0);
  });

  it("rejects a damaged file and writes nothing", () => {
    const records = makeSyntheticColloquial().map((r, i) => (i === 4 ? { ...r, register: "posh" } : r));
    writeFileSync(file(), colloquialToJson(records), "utf8");
    const result = script("import-colloquial.ts", ["--file", file(), "--persist-to", state]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("UNKNOWN_REGISTER");
    expect(result.out).toContain("chinese-slang.json:5");
    expect(count()).toBe(0);
  });

  it("imports, credits the source, and is safe to run twice", () => {
    writeFileSync(file(), colloquialToJson(makeSyntheticColloquial()), "utf8");
    for (let i = 0; i < 2; i++) {
      const result = script("import-colloquial.ts", ["--file", file(), "--persist-to", state]);
      expect(result.code, result.out).toBe(0);
      expect(result.out).toContain("Stored: 12 expressions from HearMandarin.");
      expect(result.out).toContain("CC BY 4.0");
    }
    expect(count()).toBe(12);
  });
});
