// Checks from outside that Cloudflare Access protects a deployed ShuoLab
// (SPEC §4.1, SEC-01, FR-002). Run it without being signed in:
//
//   pnpm check:access https://<your-hostname>
//
// Every request below is anonymous. Each must be stopped, either by Access
// (a redirect to the team's sign-in page, or 401/403) or by the Worker
// itself. Any request that gets a 200 is a failure. Nothing here signs in,
// and no real email address is sent.
import { fileURLToPath } from "node:url";

const FORGED_EMAIL = "owner@example.com";

/** The anonymous requests that must all be refused. */
export const PROBES = [
  { name: "app page", path: "/", headers: {} },
  { name: "owner API", path: "/api/v1/me", headers: {} },
  { name: "data export", path: "/api/v1/export?format=json", headers: {} },
  {
    name: "owner API with a forged identity header",
    path: "/api/v1/me",
    headers: { "Cf-Access-Authenticated-User-Email": FORGED_EMAIL },
  },
  {
    name: "owner API with a forged Access token",
    path: "/api/v1/me",
    headers: { "Cf-Access-Jwt-Assertion": "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIn0." },
  },
];

/** Refuses anything but an https address on a real hostname. */
export function parseTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Give the deployed address, for example https://shuolab.<you>.workers.dev");
  }
  if (url.protocol !== "https:") throw new Error("The deployed address must start with https://");
  if (/^(localhost|127\.|\[::1\])|\.localhost$/.test(url.hostname)) {
    throw new Error("This checks a deployment. Local development runs without Access on purpose.");
  }
  return url.origin;
}

/**
 * Judges one response. `location` is the redirect target, if any.
 * Returns { ok, how }.
 */
export function judge(status, location) {
  if (status >= 300 && status < 400) {
    let host;
    try {
      host = new URL(location ?? "").hostname;
    } catch {
      host = "";
    }
    if (host.endsWith(".cloudflareaccess.com")) return { ok: true, how: `sent to the Access sign-in page (${host})` };
    return { ok: false, how: `redirected to ${location ?? "nowhere"}, not to a cloudflareaccess.com sign-in page` };
  }
  if (status === 401 || status === 403) return { ok: true, how: `refused (${status})` };
  if (status >= 200 && status < 300) return { ok: false, how: `answered ${status}: this was served without signing in` };
  return { ok: false, how: `answered ${status}; expected a sign-in redirect or 401/403` };
}

export async function checkAccess(origin, fetchImpl = fetch) {
  const results = [];
  for (const probe of PROBES) {
    try {
      const res = await fetchImpl(origin + probe.path, { redirect: "manual", headers: probe.headers });
      results.push({ ...probe, ...judge(res.status, res.headers.get("location")) });
    } catch (error) {
      results.push({ ...probe, ok: false, how: `could not connect (${error instanceof Error ? error.message : String(error)})` });
    }
  }
  return results;
}

async function main() {
  const raw = process.argv.slice(2).find((a) => !a.startsWith("--"));
  let origin;
  try {
    origin = parseTarget(raw ?? "");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const results = await checkAccess(origin);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.how}`);
  const failed = results.filter((r) => !r.ok).length;
  if (failed) {
    console.log(`\n${failed} of ${results.length} checks failed. Do not use this deployment until Access is fixed (README, Deploying, step 3).`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} anonymous requests were stopped. Now sign in from a browser and check Settings shows "Signed in as" your email.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
