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
progress stays hidden. Since PR 2 a verified source manifest is also required,
so rows inserted by any route other than a validated import never count.

## 12. Only editions with known totals can be imported

`src/shared/curriculum.ts` lists the editions the importer accepts. An
unknown edition is rejected because there is nothing to verify it against.

## 13. Synthetic data lives under its own edition

Generated placeholder vocabulary is stored as edition `synthetic-fixture`,
never as `hsk3-2025-11`. The API marks it `synthetic`, the UI says "Test
data loaded, not HSK content", `curriculum:import` refuses that edition, and
`seed:dev` is local-only and will not displace a real edition without
`--force`.

## 14. The source commit is mandatory for a real import

`--commit` must be a full 40-character SHA. The importer never downloads
anything; the URL and commit are provenance records for files the owner
obtained.

## 15. All source fields except part of speech and homograph are required

The source dataset documents only those two as possibly empty, so an empty
hanzi, pinyin, entry, level label or page is treated as damage and rejected.
If the real file turns out to have legitimate blanks, this rule is revisited
with the evidence rather than loosened in advance.

## 16. Re-import never overwrites definitions and never deletes

Items are upserted on their immutable id. Definition columns are left alone
so a separately sourced gloss keeps its provenance, and no row is deleted so
future learner evidence cannot be orphaned.

## 17. Browser tests have their own database

`pnpm test:e2e` recreates `.wrangler/e2e-state` each run, so results do not
depend on what the developer has imported or seeded. Since PR 3 there are
two: an empty one and one seeded with synthetic entries
(`.wrangler/e2e-seeded`), each behind its own preview server.

## 18. Entries are paged by keyset on the syllabus number

`GET /curriculum/items` returns at most 100 rows and an opaque cursor built
from the last `source_id`. The client never holds the whole vocabulary and
loads another page only when asked. No offset paging, so deep pages cost the
same as the first.

## 19. No definitions or pinyin are generated for entries

The entry page shows what the source file holds. The syllabus has no English
glosses, so the page says so; a definition is shown only when it was imported
with a named source. Nothing is filled in by a model.

## 20. Learner state is a real filter with an honest answer

The API accepts `state`, as the SPEC contract requires, but no practice
evidence exists before Phase 4, so every entry is `unseen` and other states
return nothing. The UI does not offer the filter until it means something.

## 21. Part of speech is matched per tag

The syllabus joins tags (`数、（副）`). Filtering matches one whole tag, so 数
does not match 数量, and the brackets are ignored.

## 22. Colloquial expressions cannot enter an HSK count by construction

They live in their own table with no HSK band column and their own id
namespace (`colloquial:<source>:<slug>`). No HSK query reads that table, and
a test checks the curriculum status is identical before and after an import.

## 23. The colloquial dataset is imported from a file, not bundled

CC BY 4.0 would allow shipping it, but the owner downloads it so the app
records exactly which version was imported and nothing is fetched at build or
run time. Example sentences and audio are outside the licence and are linked,
never copied.

## 24. Usage warnings are derived from tags, in ShuoLab's own words

Register, channel and currency come from the source; the warning sentences
are authored here from those tags. A status the source has not dated is
stored as unknown rather than repeated as a claim.
