# Implementation checklist

Keyed to the functional requirements in `SPEC.md` §11. Updated at the end of
every pull request.

Status values:

- **Done** — implemented and covered by automated tests that pass.
- **Partial** — some of the requirement is implemented; the note says which part.
- **Mocked** — passes against fake providers only; the real service is untested.
- **Owner** — waiting on something only the owner can do (credentials, data, device, deployment).
- **Not started**

| ID | Requirement | Phase | Status | Evidence / what remains |
|---|---|---|---|---|
| FR-001 | First launch on mobile and desktop | 0 | Partial | Responsive shell at 320px and desktop, manifest, service worker, no JS errors (`test/e2e`). Remains: real install on iOS and Android (Owner). |
| FR-002 | Single-owner restriction | 0, 3 | Partial | Access JWT verified in the Worker; unsigned, expired, wrong-audience, wrong-issuer, wrong-person and header-only requests rejected (`test/integration/api.test.ts`). Remains: speech-token endpoint (Phase 3), verification on the deployed hostname (Owner). |
| FR-003 | Official vocabulary import, 11,000 IDs | 1 | Mocked / Owner | Importer stores exactly 11,000 IDs with the published band counts and is idempotent, proven on generated placeholder data (`test/integration/curriculum-import.test.ts`, `cli.test.ts`). Remains: run on the real dataset (Owner supplies files). |
| FR-004 | Tampered dataset fails atomically | 1 | Done | Duplicate ID, wrong level, wrong total, missing or damaged fields are rejected with file and line; nothing is written; a failure mid-write rolls back (`test/unit/curriculum-import.test.ts`, `test/integration/curriculum-import.test.ts`). |
| FR-005 | No HSK data available | 0, 2 | Partial | Honest "not imported" state in API and UI; session start blocked. Import instructions in the README and in the app. An HSK plan is refused with `CURRICULUM_MISSING`; an open conversation can be planned instead and is labelled as not an HSK lesson, with no syllabus words and no band (`test/integration/sessions.test.ts`, `test/e2e/sessions.spec.ts`). Remains: the open conversation itself (tutor PRs). |
| FR-006 | Lesson planning | 2 | Partial | Deterministic planner for 15/20/25/30 minutes: 4/5/6/8 words, at least half new at the study band, at most 20% stretch, review only from earlier sessions; listening and speaking are 60–70% of the time; one plan per study day in the owner's time zone; app-authored situations in rotation (`test/unit/planner.test.ts`, `test/integration/sessions.test.ts`, `test/client/session.test.tsx`, `test/e2e/sessions-seeded.spec.ts`). Tested with generated placeholder vocabulary only. Remains: grammar targets (no grammar data imported), review driven by mastery evidence (Phase 4), running the plan (tutor and session UI PRs). |
| FR-007 | AI hallucinates wrong HSK level | 2 | Partial | No model is involved in planning. Every planned target id and band is checked against `curriculum_items` in the active edition before the plan is saved; a mismatch fails the request. Tutor output is validated against a strict schema; an id the model gives is kept only if it is one of the session's targets as stored in `session_targets` and its word is in the reply, so invented or borrowed ids never reach a saved turn (`test/unit/tutor.test.ts`, `test/integration/turns.test.ts`). Remains: the same check for practice attempts and mastery when those tables exist (Phase 4); one live OpenAI session (Owner). |
| FR-008 | Short Mandarin voice turn | 3 | Not started | |
| FR-009 | Microphone denied | 3 | Not started | |
| FR-010 | Page reload during conversation | 2 | Partial | Finished turns are saved on the server and returned by `GET /sessions/:id` in order. Remains: the conversation screen that reloads them (PR 8). |
| FR-011 | Duplicate network submission | 2 | Partial | A turn is keyed by `(session_id, client_turn_id)` and reserved before the tutor is called: a resend returns the saved turn, a simultaneous duplicate calls the tutor once, a failed call can be retried with the same id (`test/integration/turns.test.ts`, `test/e2e/turns-seeded.spec.ts`). Remains: client retry behaviour (PR 8). |
| FR-012 | Missing speech/LLM key | 0, 2, 3 | Partial | Provider state reported as live, stand-in or not set up with guidance; never returns a secret. Without an OpenAI key the stand-in tutor answers in development and tests; in production the turn route answers 503 with setup guidance. Adapter failures (timeout, refused key, provider limit) map to authored errors with no provider text. Remains: the speech adapter (Phase 3); a live OpenAI call (Owner). |
| FR-013 | 15/20/25/30-minute plan | 2 | Partial | Plans for all four lengths with per-activity minutes (`test/unit/planner.test.ts`). Remains: running the activities in the session screen (PR 8). |
| FR-014 | Vocabulary review (FSRS) | 4 | Not started | |
| FR-015 | Mastery reporting | 4 | Not started | |
| FR-016 | HSK coverage | 0, 1, 4 | Partial | New and cumulative counts explicit, 7–9 shared, unimported sections shown as not imported, partial import never shown as verified, counts without a verified manifest never shown as verified, synthetic data labelled as not HSK. Entries can be browsed by band, searched, filtered by part of speech and opened with their source and edition (`test/integration/curriculum-items.test.ts`, `test/client/curriculum-browse.test.tsx`, `test/e2e/curriculum.spec.ts`, all on generated placeholder data). Remains: coverage by skill; filtering by learner state is accepted by the API but every entry is `unseen` until evidence exists (Phase 4). |
| FR-017 | Slang source | 1 | Mocked / Owner | Separate `colloquial_expressions` table with no HSK band column; register, channel, currency, usage warnings, credit and licence shown; HSK counts proven unchanged by a colloquial import (`test/integration/colloquial.test.ts`, `test/client/colloquial.test.tsx`, `test/e2e/curriculum.spec.ts`), all on generated placeholder rows. Remains: import the real HearMandarin file (Owner downloads it). |
| FR-018 | Monthly cost guard | 2 | Partial | Every tutor call is written to `usage_events` with tokens, an estimated cost and a status, including rejected answers. Paid requests are refused with `BUDGET_EXCEEDED` once the UTC month's estimate reaches the stop amount; the warning amount is reported on each turn and in Settings; the gate fails closed if the total cannot be read; a model with no known price is refused. 20 tutor calls a minute, 600 a day, 80 turns a session (`test/integration/turns.test.ts`, `test/client/usage.test.tsx`). Remains: speech usage (Phase 3); the estimate checked against a real OpenAI bill (Owner). |
| FR-019 | Data export | 4 | Not started | |
| FR-020 | Device switching | 2, 4 | Partial | Settings live in D1, not in the browser: a second app instance and a second browser session see the same values (`test/integration/settings.test.ts`, `test/e2e/settings.spec.ts`). Session plans are also in D1, so a plan made on one device opens on another. Remains: session turns and progress (later PRs); a check on two real devices after deployment (Owner). |
| FR-021 | Pronunciation drill (P1) | 5 | Not started | |
| FR-022 | Monthly unseen checkpoint (P1) | 5 | Not started | |

## Security and reliability requirements

| ID | Status | Evidence / what remains |
|---|---|---|
| SEC-01 | Partial | Application-layer owner check done. Remains: Access enabled on the deployed hostname (Owner). |
| SEC-02 | Partial | Secrets read only from the Worker environment; `.env.example` has names only; deploy check blocks plain-text keys. |
| SEC-03 | Not started | No audio is captured or stored anywhere yet. |
| SEC-04 | Partial | CSP and security headers on the app shell; React escapes all text. Turn input capped at 4,000 characters and 16 KB, reply at 400 characters, 80 turns a session, tutor calls rate-limited; model output is stored only after validation and never rendered as HTML. |
| SEC-05 | Not started | |
| SEC-06 | Partial | No payment, contact or location data is collected. Remains: processor disclosure and deletion. |
| REL-01 | Partial | Turns are appended durably and exactly once per `clientTurnId` (`test/integration/turns.test.ts`). Remains: review events (Phase 4); refresh and outage recovery in the UI (PR 8). |
| REL-02 | Partial | A failed tutor call saves no turn, leaves the session as it was, and returns a recoverable error; two unusable answers give a prepared reply with no feedback recorded. Remains: speech fallback to typing (Phase 3). |
| REL-03 | Partial | Exact-pinned dependencies and lockfile, versioned migrations, CI with audit. |
| PERF-01 | Not started | Not measured. |
| PRIV-01 | Partial | No transcripts exist yet; no vendor calls are made. |

## Phase gates

| Phase | Gate | Status |
|---|---|---|
| 0 | install, typecheck, lint, unit tests, build, mocked local Worker on a clean clone | Passed locally and in CI on a clean Linux checkout (PR 1). |
| 1 | verified 11k-entry real import when dataset supplied; deterministic tests for every count, homograph identity, bad-data rejection; no false official labels in UI | Tests pass on generated data. Curriculum browsing (PR 3) and colloquial track (PR 4) done. **Open:** real vocabulary import and real colloquial file (Owner). |
