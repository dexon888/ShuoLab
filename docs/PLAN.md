# Build plan: phases and pull requests

Phases follow `SPEC.md` §17 in order. Each pull request is one working vertical
slice with its own tests, and is opened only after the owner approves it. A
phase is finished when its gate passes; anything that cannot be verified
without credentials, real data or a phone is reported as an open gate, not as
done.

Every PR ends with: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`,
`pnpm build`, an updated `docs/CHECKLIST.md`, and the §21.4 attribution checks.

## Phase 0 — Scaffolding

| PR | Branch | Contents |
|---|---|---|
| 1 | `phase-0/scaffold` | Toolchain, Worker with owner auth, health/me/curriculum-status API on D1, app shell with navigation and route shells, PWA manifest and service worker, fake providers, CI, docs |

Gate: install, typecheck, lint, unit tests, build and mocked local Worker pass on a clean clone with no secrets.

## Phase 1 — Verified HSK import and browsable curriculum

| PR | Branch | Contents |
|---|---|---|
| 2 | `phase-1/vocab-import` | `pnpm curriculum:import` and `curriculum:verify`: field mapping, UTF-8/ID/band/total validation, SHA-256 and commit pinning, atomic and idempotent load, manifest rows, error report, synthetic fixtures |
| 3 | `phase-1/curriculum-browse` | Paginated items API, item detail API, curriculum pages with filters, source and status banners, attribution |
| 4 | `phase-1/colloquial-track` | `colloquial_expressions` table, optional HearMandarin import, register/channel display, excluded from every HSK count |

Gate: deterministic tests for every count, homograph identity and bad-data rejection. **Open until the owner supplies the dataset:** the real 11,000-entry import.

## Phase 2 — Sessions, planner and text tutor

| PR | Branch | Contents |
|---|---|---|
| 5 | `phase-2/settings-onboarding` | `owner_settings`, `PUT /settings`, onboarding and settings pages, cross-device persistence |
| 6 | `phase-2/session-planner` | `sessions` table, deterministic planner for 15/20/25/30 minutes, `POST /sessions/plan`, `GET /sessions/:id`, authored situation list |
| 7 | `phase-2/tutor-turns` | OpenAI Responses adapter and fake, Zod output contract with one retry and safe fallback, curriculum-ID validation, idempotent turns, `usage_events`, budget gate, rate limits |
| 8 | `phase-2/session-ui` | Typed conversation end to end, pause/resume/complete, refresh recovery, debrief |

Gate: a full typed session against the imported curriculum; invalid IDs cannot reach progress tables; works with the fake provider. One live open conversation ran locally on 2026-11-15. **Open until the real vocabulary is imported:** a live HSK session on it.

## Phase 3 — Speech and listen-first

| PR | Branch | Contents |
|---|---|---|
| 9 | `phase-3/speech-token` | Azure token issuer and fake, `POST /speech/token` with auth, quota and rate limit, usage metering |
| 10 | `phase-3/voice-ui` | Push-to-talk recognition, neural TTS playback, status cues, listen-first activity, transcript reveal tracking, typed fallback, resource cleanup |

Gate: mocked voice test passes. **Open until credentials and a phone test:** live Azure recognition and speech, token refresh, iOS and Android microphones.

## Phase 4 — Review, measurement and release hardening

| PR | Branch | Contents |
|---|---|---|
| 11 | `phase-4/evidence-review` | `practice_attempts`, per-skill mastery from evidence, FSRS cards and events, review page |
| 12 | `phase-4/progress` | Progress summary API, HSK coverage and communication dashboards with denominators and sample sizes |
| 13 | `phase-4/export-delete` | JSON and CSV export, local re-import round trip, session and full-data deletion, retention setting |
| 14 | `phase-4/release` | Accessibility and responsive pass, budget meter, deployment guide verified against a real deployment, Access verification |

Gate: every P0 requirement in `docs/CHECKLIST.md` satisfied, or listed as waiting on the owner.

## Phase 5 — P1

Not started until the Phase 4 gate passes.
