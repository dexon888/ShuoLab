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

## 62. Tap to talk, one utterance at a time

SPEC §7.4 says not to stream continuously when push-to-talk will do. Speak
listens for one utterance and stops at a pause, which also suits F0's limit
of one recognition at a time. Stop cancels.

## 63. Unsure transcripts are checked, not sent

Below Azure's 0.6 confidence the transcript goes into the box with a note,
and is sent as spoken and unsure, so the tutor gives no corrections for it
(decision 41). Clearing the box completely makes the next message typed.

## 64. The microphone count errs high

Azure counts the audio it receives, silence included, so the seconds
reported are the longer of the recognised speech and the time the microphone
was open. Synthesis is counted as the whole SSML document.

## 65. Listen first applies to the newest reply

Hiding every earlier reply would make the conversation hard to follow.
Only the newest reply is hidden, and only while replies are read aloud. The
first reveal is stored on the turn so later phases can tell listening
without reading from listening with the text.

## 66. The Azure SDK is loaded on first use

It is large and only needed for speech. Typing-only sessions never load it.

## 67. The separate listening exercise is its own PR

The plan's "Listen first" activity needs a generated exchange and
comprehension questions answered before the transcript, which is a feature
of its own. This PR covers listening to the tutor's replies.

## 68. The stand-in is never counted

It opens no microphone and plays nothing, so nothing is reported to the
speech allowance and no reply is recorded as heard.

## 69. The listening exercise is written by the tutor model

There is no licensed bank of graded listening material, so the exchange is
written for each session by the same model as the tutor, from the session's
situation and words. It is labelled with the model that wrote it. When two
answers cannot be used, a short exchange written for ShuoLab is used and
labelled as prepared. Neither is HSK content.

## 70. Questions are in English, with three options

The check is whether the Mandarin was understood, so the questions and
options are in English: reading Chinese options would test reading too.
Three options keep guessing at one in three and the screen short. Options
are shuffled on the server because models put the right answer first.

## 71. Only answers before the reveal count as listening

SPEC §6.5 and §10: the right answers stay on the server until the
questions are answered or the text is shown. The first answers sent are
kept. A result is unassisted only when the answers came before any reveal;
an assisted result is shown but not counted as listening.

## 72. One exercise per session, started by the learner

It is written when asked for, not when the session is planned, so a
session that skips it costs nothing. Starting it starts the session's clock
like a first turn. A finished session shows its exercise if it had one.

## 73. One voice for both speakers

The exchange is read in one voice with the lines in order. Two voices would
need multi-voice SSML in the speech engine; it is a possible improvement,
noted for after phone testing.

## 74. Cards are made when a session is finished

A word becomes something to review once a finished session targeted it.
Stretch words are left out, since they are exposure only (SPEC §2.4). An
abandoned session gives no cards. A word met again later keeps its card.

## 75. Two card templates for now: reading and listening

`hanzi_to_meaning` checks reading, `audio_to_meaning` listening. Both are
recall: the answer is shown only after the learner has tried, and the
learner rates themselves. There is no multiple choice (SPEC §5.5). Speaking
and writing prompts need a meaning to prompt from, and the syllabus has no
English, so they wait for the assessments work.

## 76. A recall is anything but Again

FSRS treats Hard, Good and Easy as remembered. The same line decides a
successful attempt for mastery.

## 77. Mastery is worked out again on every rating

`mastery_states` is a cache of `deriveMastery` over all qualifying attempts,
not a running counter, so it can never drift from the evidence. Days are the
owner's calendar days in their Settings time zone.

## 78. FSRS fuzz is off

Fuzz spreads due dates to avoid pile-ups, which matters with thousands of
cards. With a few cards a day, a repeatable schedule matters more, and
SPEC §14.1 asks for determinism.

## 79. Cards are not made for sessions finished before this change

When this was written, the owner's local database held only generated
placeholder words, and no finished session had targeted any, so there was
nothing to backfill. The unfinished session of that day gets cards when it
is finished.

## 80. Five observations before a rate

SPEC §5.6 asks for "insufficient evidence" below five qualifying
observations. For listening the observation is a check (one dated
exercise), not a question, so three questions on one day do not count as
three samples. For reviews it is a rating. Counts are always shown.

## 81. Practice days follow the owner's calendar; events a rolling span

Minutes are summed by each session's study date, which is already in the
owner's time zone. Listening checks, turns and ratings are counted over the
same number of days ending now, which avoids converting a local midnight
into an instant without a time-zone library.

## 82. An entry's state is its most advanced skill

Lists and the filter need one state per entry. The most advanced of the four
skills is used, and the entry page shows each skill separately, so a word
mastered for reading is never presented as mastered for speaking.

## 83. Today shows the week; Progress shows 7, 30 or 90 days

SPEC §5.2 asks for weekly listening checks on the dashboard. The Progress page
offers three fixed windows rather than a date picker.

## 84. The export is the stored rows

A versioned document with every owner table exactly as stored, rather than a
remodelled shape, so nothing is lost and re-import is a plain insert. The
curriculum is left out: it has its own source and licence.

## 85. Deleting everything keeps this month's usage ledger

The ledger holds counts and estimated cost, no text. Deleting it would reset
the month's spending and switch off the stop amount. The rows are deleted by
the next "delete everything" after the month ends.

## 86. Re-import is local only

FR-019 asks for a re-import in a local test environment. Offering it against
the deployed database would let one mistyped command overwrite real history,
so the command refuses `--remote`. A restore into production, if ever
needed, is a manual step with the owner's own D1 backup.

## 87. Retention removes conversation text, not evidence

Sessions keep their dates, minutes, listening answers and review history;
only what was typed or said and the tutor's replies go. Unfinished sessions
are never touched. It runs when a session is planned and when the setting
changes, so there is no background job.

## 88. A session is deleted from its own page

Deleting is a second, explicit step there, and the review history for its
words is kept, because it schedules future reviews and is evidence about
the words rather than about that session.

## 89. Accessibility is checked by axe in the browser tests

Every page is scanned for WCAG 2.1 A and AA problems at 320 px and desktop
against the real Worker with placeholder vocabulary, so a regression fails
CI. axe cannot judge everything, so keyboard reach, visible focus and
reduced motion have their own checks, and a screen-reader pass stays with
the owner. `@axe-core/playwright` is pinned to 4.14.0, released more than a
month before it was added.

## 90. The budget meter is a bar plus a sentence

The bar shows the estimate as a share of the stop amount, capped at full,
with a tick at the warning amount. It is hidden from screen readers because
the sentence beside it says the same thing with the dollar amounts, and the
warning is stated in words rather than by the bar turning red. It is the
only percentage on Today, and its denominator is printed next to it.

## 91. Access is verified from outside, anonymously

`pnpm check:access` asks a deployment for the page, the owner API and the
export without signing in, and again with a forged identity header and a
forged token. A redirect to a `cloudflareaccess.com` sign-in page or a
401/403 passes; anything answered normally fails. It refuses http and local
addresses, sends no cookies and uses a placeholder email, so it can be run
by anyone and tells nothing about the owner.

## 92. Grammar, characters, topics and tasks come from a second source, unverified

The vocabulary source has none of these, and there are no published totals
for them that ShuoLab can check. profesorm/hsk30 (CC BY 4.0) has all four. It
is used only after its own vocabulary list matches the stored, verified
edition entry for entry, which is strong evidence it is the same syllabus.
Even then the rows are stored as unverified, are credited on the Curriculum
page, and stay out of coverage figures and lesson planning (SPEC §2.2, §8.1).

## 93. Section rows are numbered by position in their file

The source has no ids. A row's `source_id` is its 1-based position among the
data rows of its file, which is stable for a pinned commit; the commit and
each file's checksum are stored, so a later source change is visible as a new
manifest rather than silently renumbering items.

## 94. Section details are kept as JSON on the item

Grammar type, category, detail and example sentences; the character's skill
(recognise or write); a topic's area, subject and details; a task's can-do
statement. These go in `metadata_json` rather than new columns, because no
feature reads them yet and the schema already allows it.

## 95. The owner allows the unverified sections in study

SPEC §5.2 allows only verified grammar in lesson plans. On 2026-11-26 the owner
asked for grammar, characters, topics and tasks to be used in study, review,
progress and tests anyway. They are used, but every place they appear says
they come from a second-hand transcription, and their progress is reported
apart from verified HSK vocabulary coverage. SPEC v2.3 records this as §2.5,
with requirements FR-023 to FR-027 and a new Phase 5; the former P1 phase is
now Phase 6.

## 96. Sections are browsed on the band pages

Each band page has a tab per section rather than five separate page trees, so
a band reads as one unit of the syllabus. Search in grammar, topics and tasks
matches anywhere, including details and examples, because they are phrases
rather than headwords. The list shows a one-line note per item (kind, skill,
area or can-do statement) worked out from the stored details.

## 97. Every session follows one learning cycle

An adversarial review of the spec found the sections stayed siloed: grammar
appeared once and left, corrections went nowhere, tasks were only labels, and
a session could hold more than fits in 15 minutes. SPEC §5.3 now fixes the
order (warm-up retrieval, listen, notice, read, guided practice, a
conversation that carries out the task, write, summary), §6.2 a priority with
caps and a topic change when items are recycled, §6.3 a server check of the
tutor's grammar claims, §2.5 rules that feedback flows into the next plan and
that the owner can flag a wrong row, §6.1 a task check, §5.5 separate
recognition and production evidence, and §8.3 meaningful days instead of a
streak. Character "writing" is named typed or self-rated, because handwriting
recognition is out of scope.

## 98. A grammar point is checked by the pattern in its name

The source gives no machine-readable pattern, so the name is read: 、 and ／
separate alternatives, and gaps (……, —) split one alternative into parts that
must appear in order. A point is used in study only when one of its own
syllabus examples shows that pattern, so points such as 陈述句 (a kind of
sentence) are left out of plans rather than checked wrongly. One-character
patterns (上、下、里) can match loosely; the tutor's claims and the learner's
use are recorded as practice, never as recall.

## 99. Reading, practice and writing are written once per session

One generated set per session (`session_materials`), from the saved plan,
checked for every grammar pattern and enough words with one retry; if the
model cannot be used, the reading is the grammar points' own syllabus
examples. Answers are checked by fixed criteria in code, not by the model:
the pattern, the words, and a length. It is metered with the listening
exercise and shares its limits. Typed practice answers are writing evidence,
never speaking.

## 100. Sections a session targets live in `session_items`

Words stay in `session_targets`, so every word query is unchanged; grammar,
characters, the topic and the task go in a separate table with their own
check constraint. Recycling grammar, avoiding a recent topic or task, and the
tutor's allowed grammar all read from it.

## 101. Plans have a version 2; version 1 still reads

New plan fields default when absent, so plans saved before the spine keep
opening and show their old steps.

## 102. Recognition first, then production

A word starts with its reading and listening cards; its speaking and writing
cards are added when it is first recalled, due a day later. That keeps a
session from creating dozens of cards at once and follows the order SPEC §5.5
asks for. Grammar points get all four cards at once, because a session has at
most two and its guided practice and writing already asked for production.

## 103. Typed production is checked in the browser, rated by the learner

A typing card (a word from its sound, a character from a word's pinyin, a
sentence with a pattern) is checked by the same pattern and equality rules as
the session's practice, and the result is shown before rating. The rating is
still the learner's own: the check informs it, and the typed answer is kept
with it.

## 104. Corrections are read from the turns, not stored again

What a correction touched is worked out from the saved turns and the
session's targets when a session finishes and when the next one is planned,
so there is no second copy of the corrections to keep in step or delete.

## 105. Meaningful days replace a streak

A day counts when it has both something produced (spoken, written or typed)
and something recalled in review. Minutes alone never make a day count, and
there is no streak to break.

## 106. The task check needs the learner's own words as evidence

The tutor model writes the criteria and says which were met, but a criterion
counts only when the words it quotes are found in what the learner said or
wrote, so a generous judge cannot pass a task on its own say-so. It runs once,
on request, after the session is finished, metered with the session's other
model calls; the scorer model and a version are stored with the result.

## 107. Achieving a task needs two days and two topics

One good session is not enough: a task is achieved after passing on two
different days, at least one in a different topic, which is the transfer
SPEC §6.1 asks for. Achieved tasks are planned after the rest.

## 108. Flags are owner data

A flag is the owner's judgement about a source row, so it is exported,
restored and deleted with the owner's data, and never changes the imported
row itself.

## 109. Tests are built in code, not by a model

Every question comes from imported rows with a fixed key, chosen by a seeded
generator from the band, kind and day, so the same test can be rebuilt and a
result traced to exactly what was asked. No model writes questions or judges
choices; the written task is scored by length and the band's words
(`band-test-v1`). Grammar keys come from the second-hand examples and say so.

## 110. The checkpoint measures unseen words

A monthly checkpoint uses the band-test form but only words never targeted in
a session or reviewed, and adds one spontaneous speaking task, so months can be
compared on material that practice has not touched. One per calendar month.

## 111. Tests get their own tab

Tests sit between Review and Progress in the main navigation, because they are
something to do rather than something to read.

## 112. Speed is checked on every browser-test run

PERF-01 is a browser test against the production build, so a change that
makes the dashboard or a non-model read slow fails the build rather than
being found on the phone. It measures on the local runtime, which leaves out
network time as the requirement does; the deployed figures are the owner's
check.

## 113. The goal is zero to fluent, and the app was not built for it

On 2026-11-27 the owner set the goal: from no Chinese to fluent in all four
skills, alone. An adversarial review found the MVP a sound HSK study tracker
but not an acquisition engine: no pronunciation or pinyin teaching, no word
meanings (so "mastered" was self-rated against a meaning never shown), new
words in alphabetical syllabus order, about four minutes of listening a day
in one voice, no placement or promotion, and tests drawn from the first 400
entries of a band. SPEC v2.4 §2.6 adds rules for each, Phases 6–8 order the
work, and the honesty rules stay: every gloss, generated text and model tag
is labelled with its source and never counts as verified HSK coverage.

## 114. Fluent has an operational definition and an external anchor

The app never declares fluency. It reports progress toward four concrete
targets (native audio understood, a 10-minute conversation at speed, a novel
chapter at speed, a page of writing a native reader understands), and points
to an official HSK and HSKK exam once a year as the outside check.

## 115. Tests sample the whole band

Band tests and checkpoints shuffled the first 400 entries of a band, which
are its alphabetically first words, so most of bands 4 to 7–9 were never
asked about. They now shuffle the whole band with the same seed.

## 116. Drill sounds are named exactly and heard in several voices

Each listening item carries its pinyin with a tone number, sent as an SSML
sapi phoneme, so the voice says precisely the syllable and tone intended
whatever the character's usual reading. Items alternate two Azure voices and
the tone check uses a third with syllables the units never use, following
high-variability phonetic training. Voices and phonemes are only ever taken
from authored content and checked against a fixed list and pattern.

## 117. The on-ramp is advice, not a lock

Today recommends it until the tone check is passed, but sessions stay open:
the owner may already know some Chinese, or want to mix the two.

## 118. Meanings come from CC-CEDICT, labelled, matched by sound too

The syllabus has no meanings. CC-CEDICT is free, openly licensed and complete
enough for HSK. An entry is matched by its characters and pinyin, so 好 hǎo
gets "good" and not "to be fond of"; when no reading matches, all readings are
kept and the label says so. Meanings live in `definition` with
`definition_provenance`, so the existing rule that a meaning is never shown
without its source covers them. The file is downloaded by the owner and
imported locally, like the syllabus.

## 119. The Introduce step comes before listening

A word is met with its sound, pinyin and meaning before the exchange that
uses it, so the listening is comprehensible input rather than noise. It takes
two minutes from the warm-up and the conversation; listening and speaking
stay above 50% of the session.

