import { describe, expect, it } from "vitest";
import { checkAccess, judge, parseTarget, PROBES } from "../../scripts/check-access.mjs";

describe("check:access (SEC-01)", () => {
  it("accepts only an https deployment address", () => {
    expect(parseTarget("https://shuolab.example.workers.dev/settings")).toBe("https://shuolab.example.workers.dev");
    expect(() => parseTarget("http://shuolab.example.workers.dev")).toThrow(/https/);
    expect(() => parseTarget("https://localhost:8787")).toThrow(/Local development/);
    expect(() => parseTarget("https://app.localhost")).toThrow(/Local development/);
    expect(() => parseTarget("")).toThrow(/deployed address/);
  });

  it("passes a redirect to the Access sign-in page and a 401 or 403", () => {
    expect(judge(302, "https://team.cloudflareaccess.com/cdn-cgi/access/login/x").ok).toBe(true);
    expect(judge(401, null).ok).toBe(true);
    expect(judge(403, null).ok).toBe(true);
  });

  it("fails anything served without signing in, and redirects elsewhere", () => {
    expect(judge(200, null)).toEqual({ ok: false, how: expect.stringMatching(/without signing in/) });
    expect(judge(302, "https://evil.example/cloudflareaccess.com").ok).toBe(false);
    expect(judge(302, null).ok).toBe(false);
    expect(judge(500, null).ok).toBe(false);
  });

  it("sends every probe anonymously, without following redirects, and reports each", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith("/api/v1/me") && (init.headers as Record<string, string>)["Cf-Access-Authenticated-User-Email"]) {
        return new Response("{}", { status: 200 });
      }
      return new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/login" } });
    };
    const results = await checkAccess("https://shuolab.example.workers.dev", fetchImpl as typeof fetch);
    expect(seen).toHaveLength(PROBES.length);
    for (const { init } of seen) {
      expect(init.redirect).toBe("manual");
      expect(init.credentials).toBeUndefined();
      expect(Object.keys(init.headers as object).some((h) => /cookie|authorization/i.test(h))).toBe(false);
    }
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual(["owner API with a forged identity header"]);
  });

  it("reports a connection failure as a failure", async () => {
    const results = await checkAccess("https://x.example", (async () => {
      throw new Error("ENOTFOUND");
    }) as typeof fetch);
    expect(results.every((r) => !r.ok && /could not connect/.test(r.how))).toBe(true);
  });
});
