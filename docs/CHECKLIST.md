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
| FR-005 | No HSK data available | 0, 2 | Partial | Honest "not imported" state in API and UI; session start blocked. Import instructions in the README and in the app. Remains: unlabeled free chat (Phase 2). |
| FR-006 | Lesson planning | 2 | Not started | |
| FR-007 | AI hallucinates wrong HSK level | 2 | Not started | |
| FR-008 | Short Mandarin voice turn | 3 | Not started | |
| FR-009 | Microphone denied | 3 | Not started | |
| FR-010 | Page reload during conversation | 2 | Not started | |
| FR-011 | Duplicate network submission | 2 | Not started | |
| FR-012 | Missing speech/LLM key | 0, 2, 3 | Partial | Provider state reported as live, stand-in or not set up with guidance; never returns a secret. Remains: adapters themselves. |
| FR-013 | 15/20/25/30-minute plan | 2 | Not started | |
| FR-014 | Vocabulary review (FSRS) | 4 | Not started | |
| FR-015 | Mastery reporting | 4 | Not started | |
| FR-016 | HSK coverage | 0, 1, 4 | Partial | New and cumulative counts explicit, 7–9 shared, unimported sections shown as not imported, partial import never shown as verified, counts without a verified manifest never shown as verified, synthetic data labelled as not HSK. Remains: coverage by skill. |
| FR-017 | Slang source | 1 | Not started | |
| FR-018 | Monthly cost guard | 2 | Not started | |
| FR-019 | Data export | 4 | Not started | |
| FR-020 | Device switching | 2, 4 | Not started | |
| FR-021 | Pronunciation drill (P1) | 5 | Not started | |
| FR-022 | Monthly unseen checkpoint (P1) | 5 | Not started | |

## Security and reliability requirements

| ID | Status | Evidence / what remains |
|---|---|---|
| SEC-01 | Partial | Application-layer owner check done. Remains: Access enabled on the deployed hostname (Owner). |
| SEC-02 | Partial | Secrets read only from the Worker environment; `.env.example` has names only; deploy check blocks plain-text keys. |
| SEC-03 | Not started | No audio is captured or stored anywhere yet. |
| SEC-04 | Partial | CSP and security headers on the app shell; React escapes all text. Remains: input and turn limits (Phase 2). |
| SEC-05 | Not started | |
| SEC-06 | Partial | No payment, contact or location data is collected. Remains: processor disclosure and deletion. |
| REL-01 | Not started | |
| REL-02 | Not started | |
| REL-03 | Partial | Exact-pinned dependencies and lockfile, versioned migrations, CI with audit. |
| PERF-01 | Not started | Not measured. |
| PRIV-01 | Partial | No transcripts exist yet; no vendor calls are made. |

## Phase gates

| Phase | Gate | Status |
|---|---|---|
| 0 | install, typecheck, lint, unit tests, build, mocked local Worker on a clean clone | Passed locally and in CI on a clean Linux checkout (PR 1). |
| 1 | verified 11k-entry real import when dataset supplied; deterministic tests for every count, homograph identity, bad-data rejection; no false official labels in UI | Tests pass on generated data. **Open:** real import (Owner), curriculum browsing and colloquial track (PRs 3–4). |
