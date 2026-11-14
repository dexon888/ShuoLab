import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { findDeployProblems, stripJsonComments } from "../../scripts/check-deploy-config.mjs";

const find = findDeployProblems as (config: unknown) => string[];
const strip = stripJsonComments as (text: string) => string;

const valid = {
  preview_urls: false,
  vars: { APP_ENV: "production" },
  d1_databases: [{ binding: "DB", database_id: "3f1c2a9e-1111-2222-3333-444455556666" }],
};

describe("pre-deploy configuration checks", () => {
  it("passes a safe configuration", () => {
    expect(find(valid)).toEqual([]);
  });

  it("blocks DEV_AUTH_BYPASS in deployed vars, even when false", () => {
    for (const value of ["true", "false"]) {
      const problems = find({ ...valid, vars: { ...valid.vars, DEV_AUTH_BYPASS: value } });
      expect(problems.join("\n")).toContain("DEV_AUTH_BYPASS");
    }
  });

  it("blocks plain-text provider secrets", () => {
    const problems = find({ ...valid, vars: { ...valid.vars, OPENAI_API_KEY: "sk-x" } });
    expect(problems.join("\n")).toContain("wrangler secret put OPENAI_API_KEY");
  });

  it("blocks a non-production APP_ENV, the placeholder database id and preview URLs", () => {
    expect(find({ ...valid, vars: { APP_ENV: "development" } })).toHaveLength(1);
    expect(
      find({ ...valid, d1_databases: [{ binding: "DB", database_id: "00000000-0000-0000-0000-000000000000" }] }),
    ).toHaveLength(1);
    expect(find({ ...valid, preview_urls: true })).toHaveLength(1);
    expect(find({ ...valid, preview_urls: undefined })).toHaveLength(1);
  });

  it("strips comments but not URL-like strings", () => {
    const text = '{ // note\n "a": "https://x.test/y", /* b */ "c": 1 }';
    expect(JSON.parse(strip(text))).toEqual({ a: "https://x.test/y", c: 1 });
  });

  it("keeps the committed wrangler.jsonc free of bypass flags and secrets", () => {
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const config = JSON.parse(strip(text)) as { vars: Record<string, string> };
    // The placeholder database id is the only problem expected before the owner sets it up.
    expect(find(config).filter((p) => !p.includes("database_id"))).toEqual([]);
    expect(config.vars.APP_ENV).toBe("production");
  });
});
