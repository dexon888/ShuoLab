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
| 10 | `phase-3/voice-ui` | Tap-to-talk recognition, neural TTS playback, status cues, listen-first for tutor replies, transcript reveal tracking, typed fallback, resource cleanup |
| 11 | `phase-3/listening-activity` | The plan's separate "Listen first" exercise: a short generated exchange heard before any text, with comprehension questions answered before the transcript is shown. Done |

Gate: mocked voice test passes. **Open until credentials and a phone test:** live Azure recognition and speech, token refresh, iOS and Android microphones.

## Phase 4 — Review, measurement and release hardening

| PR | Branch | Contents |
|---|---|---|
| 11 | `phase-4/evidence-review` | `practice_attempts`, per-skill mastery from evidence, FSRS cards and events, review page. Done for reading and listening cards; speaking and writing prompts and `POST /attempts` follow with the assessments |
| 12 | `phase-4/progress` | Progress summary API, HSK coverage and communication dashboards with denominators and sample sizes. Done |
| 13 | `phase-4/export-delete` | JSON and CSV export, local re-import round trip, session and full-data deletion, retention setting. Done |
| 14 | `phase-4/release` | Accessibility and responsive pass, budget meter, deployment guide verified against a real deployment, Access verification. Done in code: axe scan of every page at 320 px and desktop, keyboard and reduced-motion checks, budget meter on Today and Settings, `pnpm check:access`. The real deployment and its Access check are the owner's |

Gate: every P0 requirement in `docs/CHECKLIST.md` satisfied, or listed as waiting on the owner.

## Phase 5 — Connected syllabus

The owner asked (2026-11-26) for grammar, characters, topics and tasks to be
browsable and part of studying, with review, progress and tests connected.
These sections come from a second-hand transcription, so everything built on
them says so (SPEC v2.3 §2.5, FR-023 to FR-031; DECISIONS 95). An adversarial review of
the spec on 2026-11-26 added the session spine, planner priority and caps,
checked grammar use, forward-flowing feedback, task checks, separate
production evidence, a flag-as-wrong control and meaningful days (DECISIONS 97).

| PR | Branch | Contents |
|---|---|---|
| A | `phase-5/browse-sections` | Browse grammar, characters, topics and tasks by band, with search, details, examples and source credit |
| B | `phase-5/session-spine` | The §5.3 spine (warm-up, listen, notice, read, guided practice, task conversation, write, summary); planner priority, caps, weakest-skill time shift and topic change for recycled items (§6.2); task as the session goal; tutor grammar claims checked and unused points elicited (FR-024, FR-028). Done |
| C | `phase-5/section-review` | Grammar and character cards (characters shown in words), speaking and writing production cards, corrections feeding cards and the next plan, production mastery only from production evidence; section progress, skill balance and meaningful days (FR-025, FR-026, FR-029). Done |
| D | `phase-5/task-check` | Task check with 2–3 criteria and a stored scorer version, tasks achieved per band; flag an unverified row as wrong (FR-030, FR-031). Done |
| E | `phase-5/speaking-writing-review` | Folded into C. Done there |
| F | `phase-5/tests` | Band practice tests from imported items set in band tasks and topics, unverified keys labelled; the monthly unseen checkpoint (FR-027, FR-022). Done |

Each is tested, documented and shipped on its own, in this order.

## Phase 6 — Zero to fluent, foundations

The owner starts from no Chinese and wants fluency in all four skills. An
adversarial review on 2026-11-27 (DECISIONS 113) found a beginner stalls in
week 1 and input is far too small. SPEC v2.4 §2.6 sets the rules.

| PR | Branch | Contents |
|---|---|---|
| — | `phase-6/spec` | SPEC v2.4, this plan, checklist rows FR-032 to FR-038; tests sample the whole band. Done |
| A1 | `phase-6/sound-system` | On-ramp units for initials, finals, tones, tone changes and pinyin typing; multi-voice tone drills; the tone check; Today recommends it until passed (FR-032). Done |
| A2 | `phase-6/meanings` | CC-CEDICT import with provenance (owner downloads or approves the download); Introduce step; meanings on recognition cards and in the notice step (FR-033). Done in code; the owner imports the dictionary |
| A3 | `phase-6/coherent-targets` | Task and topic first; new words from their text, then shared characters, then the band (FR-034). Done |
| A4 | `phase-6/pitched-input` | Known-word coverage on tutor replies and generated texts, regenerate below target, beginner scaffolds, reply length growing with the learner's (FR-035). Done |
| A5 | `phase-6/stories` | Graded stories and dialogues outside the session, multi-voice audio cached, glosses, questions before translation, input minutes (FR-036). Done |
| A6 | `phase-6/placement` | Placement across every band, vocabulary-size estimate, promotion rule (FR-037); word questions on meaning (FR-038). Done |

## Phase 7 — Zero to fluent, skills

Shadowing with pronunciation assessment, speaking fluency tasks with speech
rate and pauses, the character system, a bridge to real Mandarin, and
measurement fixes (SPEC §17 Phase 7).

| # | Branch | What |
|---|---|---|
| B1 | `phase-7/shadowing` | Shadowing in Notice with Azure pronunciation assessment, weakest characters, own attempt kept on the device, scores trended on Progress (FR-039). Done |
| B2 | `phase-7/fluency` | Retelling and timed narration with speech rate, mean length of run and pauses (FR-040) |
| B3 | `phase-7/characters` | Components, phonetic series, frequency order, homophone choice (FR-041) |
| B4 | `phase-7/bridge` | Paste a text for coverage and sentence mining; outside-input log (FR-042) |
| B5 | `phase-7/measurement` | Vocabulary size over time, rubric-scored writing (FR-043) |

## Phase 8 — Later

Progress toward the operational definition of fluent with external anchors,
tutor memory, short days and a review cap, beyond-HSK frequency track,
licensed native audio, and the remaining P1 items.
