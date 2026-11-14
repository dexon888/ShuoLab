# Architecture decision log

Short records of choices that are not already fixed by `SPEC.md`, and of any
deviation from it. Newest last.

## 1. One Vite project runs both the client and the Worker

`@cloudflare/vite-plugin` runs `src/server` inside workerd during `vite dev`
and `vite preview`, next to the React client, with local D1. `pnpm dev` is
therefore one process, and the e2e tests exercise the real Worker runtime
rather than a Node approximation.

## 2. Dev sign-in bypass needs three things to be true

`DEV_AUTH_BYPASS=true` only works when `APP_ENV` is `development` or `test`
**and** the request is addressed to a loopback host. `APP_ENV` defaults to
`production` in `wrangler.jsonc`, and any unknown value is treated as
production. If the flag is seen in production, every API route — including
`/health` — returns a 500 so the mistake is impossible to miss. `pnpm deploy`
also refuses to run if the flag appears in `wrangler.jsonc`.

## 3. Access JWT is verified in the Worker with `jose`

The Worker verifies signature, issuer, audience and expiry against the team's
JWKS and then compares the `email` claim to `OWNER_EMAIL`. It never reads
`Cf-Access-Authenticated-User-Email`. Missing Access configuration fails
closed with a 503. Static assets are not checked by the Worker; they are
protected by Cloudflare Access at the edge and contain no personal data.

## 4. Preview URLs are disabled

`preview_urls: false` so that only one hostname exists and needs an Access
policy (SPEC §4.1). The deploy check enforces this.

## 5. Integration tests use Wrangler's local D1 from Node

Tests get an in-memory D1 from Wrangler's `getPlatformProxy` and apply the same SQL
migration files that Wrangler applies. `@cloudflare/vitest-pool-workers` was
not used because at the time of writing it requires Vitest 4 while the project
is on Vitest 5.

## 6. TypeScript 6.0, not 7

`typescript-eslint` 8.72 supports TypeScript below 6.1, so TypeScript is held
at `~6.0`.

## 7. Static manifest file; service worker from `vite-plugin-pwa`

The manifest is `public/manifest.webmanifest` as the spec's layout shows. The
plugin only generates the service worker, which precaches the app shell and
never caches `/api/*`. Registration happens in `main.tsx` so the CSP needs no
inline script allowance.

## 8. No web fonts

The interface uses the device's own UI and CJK fonts, with a Kai face for
Chinese page titles where the device has one. Nothing is downloaded, which
keeps the CSP tight and the offline shell small.

## 9. Setup steps live in `README.md` only

The spec suggests `docs/SETUP.md` and also requires the README to contain the
full setup. To avoid two copies drifting apart there is no `docs/SETUP.md`.

## 10. Curriculum reference tables are created in Phase 0

`curriculum_editions`, `source_manifests` and `curriculum_items` exist from
the first migration so that the app can answer "what is imported?" from the
database instead of from a hard-coded placeholder. The importer that fills
them is Phase 1. Two columns were added to `source_manifests` beyond §8.1:
`field_mapping_version` (required by §2.2 #2) and `verification_status`
(needed to keep unverified secondary datasets out of coverage, §8.1).

## 11. Vocabulary is "verified" only when every band matches the published total

A partial or over-full import is reported as "imported, not verified" and HSK
progress stays hidden.
