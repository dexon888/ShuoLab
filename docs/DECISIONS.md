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

## 25. One settings row, enforced by the database

`owner_settings` has a CHECK that allows only the id `owner`, so a second
row cannot exist. The API reads and upserts that row; before the first save it
returns defaults without writing anything.

## 26. The settings schema is the whitelist

`PUT /settings` accepts any subset of the editable fields through a strict
Zod schema. An unknown field is an error, not something to ignore, so nothing
can be written that the schema does not name. `locale`, `updatedAt` and
`onboardedAt` are not writable; onboarding is marked with `onboarded: true`
and keeps its first timestamp.

## 27. A chosen band and a self-rating are never a measured level

Onboarding stores the owner's own estimate and an optional study band. The UI
says both are choices. With no band chosen the planner will suggest HSK 1. The
placement sample is P1 and is shown as not built.

## 28. Spending limits are stored before they are enforced

The amounts are editable now so the tutor PR only has to read them. The UI
says they are not yet enforced and are not a provider-side cap.

## 29. Cross-site writes are refused by Origin

Access cookies are sent by the browser automatically, so a state-changing
request whose `Origin` is another host gets 403. JSON-only bodies also force
a preflight that the API never approves.

## 30. The session planner is code, not a model

Choosing the words, their roles and the time budget is deterministic and
makes no provider call: the same database state and date give the same plan.
The planner is a pure function over candidates read from D1, so it costs
nothing and cannot invent an entry or a band. Before a plan is saved every
target id and band is checked again against `curriculum_items`.

## 31. One plan per study day

`POST /sessions/plan` returns today's unfinished session if there is one,
where "today" is the date in the owner's time zone. A plan that was never
started is replaced (marked abandoned, not deleted) only when the requested
kind, length or band differs. Tapping Start twice, or on two devices, does not
make two sessions.

## 32. Words rotate by exposure until there is mastery evidence

There is no mastery data yet, so "new" means not targeted by an earlier
session and "review" means targeted by one. The plan page says that appearing
in a plan is not evidence of knowing a word. Phase 4 replaces this with the
evidence model; nothing here writes to mastery.

## 33. Situations are app-authored and labelled

The scenario list is written for ShuoLab and carries `sourceType:
"app-authored"`. The UI says a situation is not an HSK topic or task. They
rotate so none repeats until all have been used.

## 34. Stretch and colloquial content stay inside limits

At most 20% of the words come from the next band, only in sessions of six or
more words, and they are labelled as exposure. At most one colloquial
expression is added, by the slang setting: none at low, and never one marked
very informal. It is shown apart from the HSK words with its usage warnings.

## 35. Open conversation is a separate kind of session

With no verified vocabulary an HSK plan is refused. An open conversation has
no edition, no band and no targets, enforced by a table CHECK, and is
labelled as not an HSK lesson so it can never count toward HSK coverage.

## 36. Validation lives in the turn service, not in the provider adapter

An adapter moves text and reports token counts. Parsing, schema checks, the
Mandarin check, the retry and the fallback are done once in the turn service,
so every provider, including the stand-in, goes through the same checks.

## 37. An id from the model is dropped, not trusted and not fatal

SPEC §6.4 says to reject invented ids and §9 says to remove a non-matching
reference. A reply with a bad id is still a usable reply, so the id is
removed and the reply kept. An id survives only if it is one of the session's
targets in `session_targets` and that target's word appears in the reply.
The model's claim that it "used" a word is not evidence.

## 38. The turn row is reserved before the tutor is called

Looking up `clientTurnId` after the call would let two simultaneous copies of
a message both call the tutor. The row is inserted as `pending` first; the
unique index decides the winner and the other request gets a retryable 409.
A `pending` row older than a minute, or a `failed` one, can be taken over
with the same id.

## 39. A reused clientTurnId with different text is a conflict

Returning the saved turn for different text would silently drop what the
learner wrote. It gets 409 instead.

## 40. Two unusable answers give a prepared reply

After one retry the turn is completed with one of three authored Mandarin
replies, marked `fallback`, with no corrections, no "understood" flag and no
ids. The learner can keep talking and nothing false is recorded.

## 41. Unsure speech recognition means no corrections

When `asrUncertain` is set on a speech turn the instructions ask for no
corrections and the service removes any that come back. A typed turn is
never treated as unsure.

## 42. The budget is a sum over a ledger, in UTC months

There is no running counter to drift. Rejected answers count, because they
were billed. The stop applies only to providers that cost money, so the
stand-in keeps working at a zero budget. This supersedes decision 28: the
amounts are now enforced for the tutor.

## 43. Prices are data with a date, and an unknown price is refused

The built-in price is for the default model and is dated. Any other model
needs both price variables. Running a model whose cost cannot be estimated
would make the stop amount meaningless, so the request is refused.

## 44. Rate limits use the ledger too

Counting `usage_events` rows in the last minute and day needs no extra
infrastructure and costs one indexed query per turn.

## 45. BUDGET_EXCEEDED is its own error code

It shares status 429 with `RATE_LIMITED` but is not retryable and needs a
different message, so the client can tell "wait a moment" from "raise the
amount or wait for next month".

## 46. Practice time is measured on the server from gaps between actions

The client does not report durations, so they cannot be inflated or counted
twice. Each turn, pause and completion adds the time since the last action,
capped at three minutes; paused time adds nothing. This undercounts long
thinking pauses and counts nothing before the first message. It is labelled
as practice time between actions, not as time spent.

## 47. Corrections are shown in the summary, not during the conversation

SPEC §5.3 asks for recasts while speaking and coaching in the debrief. The
conversation shows the tutor's reply only; the summary shows at most three
corrections, newest first, without repeats.

## 48. The summary reports use, never knowledge

It says whether the learner wrote a planned word and whether the tutor used
it, by looking for the word in the saved text. It has no score, level or
percentage and changes no progress table. "Worth meeting again" is the list
of planned words the learner did not write, excluding stretch words.

## 49. A paused session refuses turns

Accepting a turn while paused would silently resume the clock. The learner
resumes first. A turn that was already answered can still be read back.

## 50. Completing needs at least one turn; abandoning does not

A plan with no conversation has nothing to summarise, so it can be abandoned
(or replaced from Today) but not completed. Abandoned sessions keep their
turns, have no summary, and free the day for a new plan.

## 51. One message id per message, kept across retries and reloads

The client makes the `clientTurnId` when a message is sent and stores it with
the text until the server confirms it. "Send again" reuses it; "Edit message"
first asks the server whether the message arrived, and only if it did not
puts the text back for a new message with a new id.

## 52. English is shown on request

The tutor's reply shows characters, and pinyin unless the reading-help
setting is "characters only". The translation sits behind "Show English"
unless the setting asks for English as well.

## 53. Whole-session browser tests get their own databases

A day has one session, so the desktop and 320px runs would fight over it in a
shared database. Each gets its own seeded database and preview server.

## 54. An empty OpenAI account is not "busy"

OpenAI answers HTTP 429 both for rate limits and for an account with no
credit. The first live call hit the second case and the app said "busy, wait
and try again", which could never work. On 429 the adapter now reads the
error's machine-readable type and code (never its message) and reports
`insufficient_quota`, `credit_balance_exhausted` and
`billing_hard_limit_reached` as a non-retryable "no credit" error that names
OpenAI billing and says it is separate from ShuoLab's own amounts.

## 55. The tutor always returns pinyin and English; the app decides what to show

The first live run showed the model leaving both optional fields empty, so
the reading-help setting had nothing to show. The instructions now ask for
both on every reply. It adds a few output tokens per turn.

## 56. Browser tests never see a provider key

The Cloudflare Vite plugin copies `.dev.vars` into the build, and the preview
servers that run the browser tests read it from there. With a real key in
`.dev.vars`, the tests called OpenAI. `scripts/prepare-e2e.mjs` now replaces
the built vars with test-only values after building and refuses to continue
if a provider key remains. The tests also assert the stand-in tutor, so a
regression shows up as failures rather than as charges.

## 57. Speech is limited by the free allowance, not by dollars

SPEC §4.3 says never to move to a paid Azure tier. The gate is therefore the
F0 allowance: seconds of recognition and characters of voice per month.
Configuration may lower the limits but not raise them, so a typo cannot
open the way to a paid tier's worth of use.

## 58. The browser reports speech use

Audio goes from the browser to Azure and never through the Worker, so only
the browser knows how long an utterance was. Reports are capped per event
(60 seconds, the short-audio limit; 2,000 characters) and counted once per
`clientEventId`. A browser that under-reports could exceed the allowance;
Azure's own F0 limit is the backstop, and Azure's count is the one to trust.

## 59. Half an allowance still gets a token

The token serves both recognition and voice. When only one is used up, the
token is issued and the allowance says which half is unavailable, so a
session can still speak replies aloud after recognition runs out, or the
other way round.

## 60. The token is a POST, refreshed at nine minutes

A GET could be fetched by a link or kept by a cache. Azure tokens last ten
minutes and Microsoft recommends reusing one for nine, so `expiresAt` is
nine minutes out. The token is never written to the database or logs; only
the fact that one was issued is.

## 61. The region is checked before it becomes part of a URL

`AZURE_SPEECH_REGION` is placed in the STS hostname, so only a plain region
name is accepted.
