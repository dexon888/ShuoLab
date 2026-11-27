# ShuoLab — Chinese Immersion Learning Assistant
## Technical Requirements & Implementation Specification (TRD)

**Version:** 2.3  
**Date:** 2026-11-26 (v2.2 of 2026-11-13 amended by the owner: connected syllabus, §2.5)  
**Audience:** Claude Code / implementing developer  
**Status:** Build-ready MVP specification; existing private GitHub repository is owned and created by the user; credentials and provider accounts are supplied by the owner  
**Product type:** ShuoLab — single-user, private, cross-device Mandarin learning PWA  
**Priority legend:** `P0` must ship in the first usable release; `P1` follows a stable MVP; `P2` optional.

> **Implementer instruction:** Treat this specification as the source of truth. Implement P0 in the phase order in §17 and obey the GitHub attribution policy in §21. Build a fully running, testable application rather than a mockup. Do not assume API credentials, official data rights, or external accounts exist. Use documented mocks/local development when credentials are missing; make live integration possible through environment secrets. Do not silently substitute AI-invented vocabulary lists for real HSK data. Never commit keys or private user transcripts. Prefer simple, reliable code over microservices or speculative abstractions.

---

## 1. Product vision, users, and success criteria

### 1.1 Problem
Traditional gamified language-learning apps tend to reward completion and recall rather than sustained ability to listen to rapid natural speech and respond spontaneously. This product should primarily create **daily Mandarin immersion and conversation practice**, with the HSK syllabus acting as a **verifiable curriculum spine**.

### 1.2 User and environment
- Exactly **one owner account**; no public sign-ups, teams, payments, social feed, or admin portal.
- Runs in a modern desktop browser and as an installable **Progressive Web App (PWA)** on iOS and Android where supported.
- Intended use: **15–30 minutes per day**, with phone-first microphone usability and keyboard-friendly desktop UI.
- Target language: **standard spoken Mandarin (`zh-CN`)**, Simplified Chinese characters by default; pinyin and English are *optional scaffolding*, not always-on translations.
- The owner may customize initial placement, native-language help, daily length, speech rate, and comfort with natural/colloquial language.
- HSK progress and actual speaking/listening progress are different measurements and must remain separate.

### 1.3 Primary outcomes
1. Understand everyday Mandarin without always seeing captions or English translations.
2. Speak Mandarin extemporaneously in realistic, branching dialogues.
3. Build HSK-grounded vocabulary, grammar, character reading and writing knowledge.
4. Encounter natural fillers, conversational register, idioms, and current slang **with usage warnings**.
5. See evidence-based progress over weeks and months, not an invented “fluent” badge.

### 1.4 Non-goals for MVP
- Official HSK certification or guaranteed HSK passing scores.
- A native iOS/Android app-store release, handwriting-stroke recognition, multiplayer, speech cloning, live video, social features, paid subscriptions, or fully offline voice AI.
- Continuous, interruptible, real-time AI calling. **Turn-based voice conversation** is the MVP.
- Separate HSK 7/8/9 lexical lists: the verified 2025 syllabus uses a **shared HSK 7–9 advanced band**.
- Guaranteed tone grading in spontaneous speech; speech recognition and pronunciation assessment measure different things.

### 1.5 Product success / acceptance at launch
- On a phone and desktop, the owner completes a **20-minute Mandarin session**, including listening, speaking, reading, writing or recall, and review, without losing progress after refresh.
- At least one **authenticated, persisted** conversation includes 6+ spoken turns; transcripts and feedback persist and can be reviewed later.
- A curriculum import produces the **11,000 numbered HSK 3.0 vocabulary records** in a canonical, versioned schema and passes integrity checks; the app visibly reports if content is missing.
- Every HSK-labeled practice item has an actual `curriculum_item_id` linked to an imported source row; the AI cannot self-assign official levels.
- Separate dashboards show (a) HSK curriculum coverage and (b) conversational/listening performance, clearly noting what has **not** been formally assessed.
- The one-user application is access-controlled; secret API keys cannot be retrieved in browser bundles, response payloads or repository history.
- At the end of each day, the owner can export data to JSON and CSV without paying any service fees.

---

## 2. Verified curriculum/data sources and rights

### 2.1 Canonical HSK framework — mandatory
**Canonical edition:** November 2025 *HSK Examination Syllabus* (HSK 3.0), referenced by the official Chinese Test Service site.

Official portal: <https://www.chinesetest.cn/HSK> (links to the **Examination Syllabus**, **Sample Questions**, and **Competency Profile**).

The official framework covers **tasks, topics, vocabulary, grammar and Chinese characters**; HSK 3.0 has elementary/intermediate/advanced stages across nine certification levels. The syllabus edition and date must be stored. A future edition must never silently overwrite historic results. The published worldwide launch announcement names **2026-12-13**; application content version is independent of an exam registration date.

**Import-friendly vocabulary source:** <https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset>. It transcribes all 11,000 numbered entries from the November 2025 edition and includes `id`, `level`, `hanzi`, `pinyin`, `part_of_speech`, `entry`, `homograph`, `level_label`, and `source_pdf_page`. English definitions are **not** included. The repo distinguishes cumulative and newly introduced vocabulary lists; import only the **new entries per level** or a de-duplicated canonical complete file so each numbered source ID is inserted exactly once.

**Additional structured data candidate:** <https://github.com/profesorm/hsk30> contains grammar, characters, and vocabulary datasets; inspect source fields and use only data that can be mapped to the official edition, with attribution and validation. Treat this independent extraction as an **unverified secondary transcription** until checked; do not conflate it with the official publisher. **Owner decision (2026-11-26):** its grammar, character, topic and task lists are imported and used in study under the rules of §2.5, after its own vocabulary list matches the verified vocabulary entry for entry.

**HSK first-introduction totals to validate against:**

| First introduced at | New numbered entries | Cumulative numbered entries |
|---|---:|---:|
| HSK 1 | 300 | 300 |
| HSK 2 | 200 | 500 |
| HSK 3 | 500 | 1,000 |
| HSK 4 | 1,000 | 2,000 |
| HSK 5 | 1,600 | 3,600 |
| HSK 6 | 1,800 | 5,400 |
| HSK 7–9 (shared band) | 5,600 | 11,000 |

These counts represent **numbered syllabus entries**, not unique written forms. Never deduplicate homographs solely by Hanzi, and never invent distinct level-7, -8 and -9 vocabulary assignments. The older HSK 2.0 and the separate 2021 grading standard have different entry totals; do **not** blend these source versions.

### 2.2 Import behavior — P0
Build a reproducible Node/TypeScript import tool:

`pnpm curriculum:import --source ./private-data/hsk-vocab --edition hsk3-2025-11`

Requirements:
1. Accept a directory containing **user-provided** CSV/JSON for vocabulary and optionally grammar, tasks, topics, characters; document exact expected field mappings. Include optional downloading instructions, but do not hardcode unreviewed `latest` GitHub URLs as trusted content.
2. Pin the data source repository **commit SHA** and calculate the SHA-256 of each imported file. Store source URL, commit, checksum, license/rights note, import timestamp and field-mapping version in `source_manifests`.
3. Validate UTF-8, required fields, valid HSK bands, unique source IDs per edition, 1–11,000 coverage, exact total counts and absence of unknown level codes. Fail the import **atomically** with a detailed error report if validation fails.
4. Preserve `entry`, `homograph`, `source_pdf_page` and `level_label` to distinguish repeated forms and later-use annotations.
5. Never claim user-visible English definitions are “official” when they come from a separate lexicon or AI-generated gloss. Track a `definition_provenance` field; a missing definition is acceptable.
6. Use **upsert or staging-table + transaction** semantics so re-running the identical import is idempotent, does not duplicate rows, and does not erase learner evidence.
7. Maintain edition history rather than rewriting source IDs in place; all progress references immutable `(edition, item_type, source_item_id)` keys.
8. Report **verified/imported/missing** status for grammar, topics, tasks, characters individually. If secondary datasets are unavailable, do not claim coverage for those dimensions; ship vocabulary-first and display an honest “not imported” state. An imported but unverified section may be used in study only as §2.5 allows, and is never reported as verified.
9. Keep bulk official syllabus files out of public Git repositories by default (`private-data/` in `.gitignore`). A single-user local import is not a grant to republish copyrighted examination material.
10. Before importing a secondary source for grammar, characters, topics or tasks, check that its own vocabulary list (if any) matches the verified vocabulary of the active edition; refuse the import on any difference. Store each section's rows with their details (e.g. grammar kind and example sentences, character skill) and a manifest marked `unverified`.

**Rights caveat:** Source repositories can make files publicly readable without granting redistribution rights to the underlying official syllabus. Include source attribution, inspect each repository's license and original-content rights, and do not bundle the full syllabus in public app assets. Do not automate scraping of protected sites or paywall bypasses. If licensing is unclear, require the owner to acquire/download the source and import it locally; provide fixture data for tests only.

### 2.3 Natural Mandarin / slang — separate content track
Candidate dataset: <https://hearmandarin.com/datasets/chinese-slang/>. As checked in November 2026 it contains **185 expressions** in downloadable CSV/JSON under **CC BY 4.0** with `term`, `pinyin`, `category`, `register`, `channel`, `status`, and `checked` metadata. **Examples and audio linked from the site are not part of that dataset license**; don't copy them without additional permission.

Implement `colloquial_expressions` as a **separate namespace** (`hsk_level = NULL`, `source_type = colloquial`) rather than treating slang as HSK content. Carry credit (“HearMandarin”, source URL, license), mark `register` (formal/neutral/casual/very informal), `channel` (spoken/typed/both), `region`, `currency_status` (hot/steady/fading/unknown), and `last_verified_at`. An AI may propose new colloquialisms but these are staged as `unverified` and excluded from official HSK counts until user-reviewed. Display register and context notes to avoid socially inappropriate use.

### 2.4 Curriculum-to-practice contract — P0
Each session plan has:
- `syllabus_edition`, `target_hsk_band`, `target_item_ids[]`, `target_grammar_ids[]` (when imported; unverified grammar under §2.5), `target_character_ids[]` (characters of the target words that are on the band's lists), `communicative_goal`, `topic_id` and `task_id` (when imported; otherwise an app-authored situation), `colloquial_ids[]` separately, and `level_constraints`.
- When a task is imported, `communicative_goal` is that task's can-do statement; the conversation and the writing step both aim at it, and the task check (§6.1) judges it. Otherwise it is the app-authored situation's goal.
- Session topic and phrase suggestions chosen by a **deterministic planner querying the local curriculum database** before the AI is invoked.
- The AI receives a small list of **valid source IDs and actual words** as context, NOT instructions to invent level assignments.
- Generated exercises and feedback must be schema-validated and checked for allowed IDs. A generated item missing a valid HSK source ID can still be displayed as **“natural language / extra”**, never as official HSK.
- A complete session log includes the IDs actually practiced, the skill and level of evidence, the outcome, model version and timestamps.
- Authentic dialogs can include unknown words to support immersion; unfamiliar content is tagged `stretch` and is **not** counted toward target-level mastery unless explicitly tested.

**Acceptance test:** If HSK 2 item `source_id=9999` is requested, the backend must reject the mapping if the imported row is in a different band; it must not rely on the language model's assertion.

### 2.5 Connected syllabus — P0 (owner amendment, 2026-11-26)
Vocabulary, grammar, characters, topics and tasks are one connected curriculum. Every imported section must be usable end to end, not only stored:

| Section | Browse (§5.4) | Lesson plan (§6.2) | Tutor and activities (§5.3, §6.3) | Review (§5.5) | Mastery and progress (§5.6, §6.1) | Tests (§6.5) |
|---|---|---|---|---|---|---|
| Vocabulary | by band, search, filters | up to 5 new + review (§6.2) | in the listening exchange, reading, guided practice, conversation and writing (§5.3) | recognition (reading, listening) and production (speaking, writing) cards | per skill | band practice test, checkpoint |
| Grammar | by band, search, kind, examples | 1 new + 1 recycled at most | heard in the exchange, shown in the notice step, drilled in guided practice, elicited in conversation, required in writing | understand an example (listening, reading); make a sentence (speaking, writing) | per skill | band practice test |
| Characters | by band, recognise/write lists | characters of the target words, plus up to 3 band characters met in known words | highlighted in the reading text inside their words | recognise (shown in 1–3 known words); produce by typing or self-rated copying | reading; writing as “typed/self-rated” | band practice test |
| Topics | by band, area, subject | one per session; recycled items change topic | the setting of the exchange, reading and conversation | — | exposure count per band | test passages set in band topics |
| Tasks | by band, can-do statement | one per session; it is the session's goal | what the conversation and writing must accomplish | — | **achieved** by the task check (§6.1) | test items framed as band tasks |

Rules:
1. **Provenance is always visible.** Anything built on an unverified section says so where it appears (plan, tutor context, review card, progress, test) and links to its source credit.
2. **Separate figures.** Progress on unverified sections is reported per section, beside but never merged into verified vocabulary coverage, and never as an HSK score.
3. **Allowed ids only.** The planner picks section items from the database; the tutor receives their ids and text and may not invent others. Model output referring to an id outside the plan is dropped, as for vocabulary (§2.4).
4. **Evidence, not exposure.** A grammar point or character is mastered by the same rule as a word (§6.1), from rated recall and scored test items, never from appearing in a lesson. A task is achieved only by passing its task check; a topic only ever counts as exposure.
5. **Optional by data.** With a section not imported, everything else keeps working and that section's parts are hidden or show “not imported”.
6. **One cycle, every session.** Each target passes through input → noticing → guided practice → use in the task → feedback → spaced retrieval (§5.3, §5.5); items still being learned return in a different topic within 2–7 days to test transfer (§6.2).
7. **Feedback flows forward.** Every correction in a summary creates or advances a review card for that item and skill and is the first priority of the next plan (§6.2).
8. **Owner can flag a row as wrong.** A flagged row from an unverified section is excluded from plans, cards and test keys; the flag is kept with a note and listed on the Curriculum page.

---

## 3. Technology decisions (optimized for one-user cost)

| Layer | Concrete technology | Decision / reason |
|---|---|---|
| Client | React + TypeScript + Vite | Small client-only SPA, good mobile/desktop UX |
| Installable PWA | `vite-plugin-pwa`, service worker | One codebase, home-screen install, cache static assets |
| UI | Tailwind CSS + accessible headless components | Responsive and keyboard-accessible UI |
| Router / data | React Router + TanStack Query | Routes, request caching and retries |
| API | Cloudflare Worker (TypeScript) + Hono | No permanent server; same-origin API under `/api` |
| Hosting | Cloudflare Workers Static Assets | Publish SPA and API as one deployment |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM | SQL, migrations, simple single-owner persistence |
| Auth | Cloudflare Access, owner allowlist | No custom passwords, public signup or identity database |
| LLM | OpenAI Responses API; default `gpt-6-luna` | Low-cost tutor; model name configured in env |
| Optional stronger LLM | `gpt-6.1-terra` | Use for controlled quality comparisons, not automatically |
| Speech-to-text | Azure AI Speech JS SDK `zh-CN` | Real-time/short-turn Mandarin transcription |
| Text-to-speech | Azure Neural TTS `zh-CN` | Natural Mandarin audio and adjustable speaking rate |
| Pronunciation | Azure Pronunciation Assessment `zh-CN` | Reference-text drills only, not a universal tone detector |
| Reviews | `ts-fsrs` | Deterministic scheduling and durable review history |
| Pinyin | `pinyin-pro` (presentation help) | Display transliteration, not official source of readings |
| Test suite | Vitest + Testing Library + Playwright | Unit, integration, browser/e2e testing |
| Package manager | pnpm, Node LTS | Reproducible lockfile and CI |
| Observability | Structured logs and per-provider usage rows | Minimal cost, no third-party analytics SDK |

**Why not AWS / Kubernetes / Next.js SSR / Supabase for MVP?** None is needed for one private client-rendered app. Choose Cloudflare because its Workers/D1/Static Assets make a compact deployment. No Redis, message queues, vector database, custom embeddings, or separate auth server until measured needs justify them. Use a single TypeScript workspace with clear service boundaries so migration is possible.

**Important vendor boundary:** The LLM only sees text, compact curriculum metadata, and necessary session context; raw speech goes to Azure speech processing, not the text-only model. Make provider adapters mockable for CI.

---

## 4. Architecture and runtime boundaries

```text
  Desktop browser / installed mobile PWA
  React UI + audio capture + Azure Speech SDK
         | HTTPS, same-origin /api, Access-protected
         v
  Cloudflare Worker (Hono / TypeScript)
     |-- Access verification / owner allowlist / validation / rate limits
     |-- Session planner -> D1 curriculum & mastery
     |-- Tutor orchestrator -> OpenAI Responses API
     |-- /speech/token -> Azure auth token issuer (not raw key)
     |-- Practice / review / progress -> D1
     |-- JSON + CSV export, usage guards
         |
         +--> Cloudflare D1 (persistent SQLite)
         +--> OpenAI (text, structured output)
         +--> Azure Speech (browser SDK via short-lived token)

  No stored raw audio by default. All transcripts, item evidence,
  session feedback and review schedules live in D1.
```

### 4.1 Trust model
- Cloudflare Access must protect **the deployed Worker and its associated domains**, including preview URLs. Use an allowlist for the sole owner email; reject unknown identities.
- For `/api/*`, **verify authentication at the application layer**, not solely by believing client-provided headers. Cloudflare `ctx.access` may be absent in Static Assets-router configurations; validate the Cloudflare Access JWT with `jose` against the published JWKS/AUD/issuer when necessary. Never read an unverified `CF-Access-Authenticated-User-Email` header as a trustworthy identity.
- For local development only, allow an explicit `DEV_AUTH_BYPASS=true` in the local configuration and a hard fail if it is present in a production build/deployment.
- No provider secrets in `VITE_*` variables, source, logs, localStorage or client JSON.
- Speech token endpoint may return a **short-lived Azure authorization token** and region, not a resource key; rotate/renew before expiry. Bearer tokens are still sensitive and should be kept in memory only.
- Cloudflare Worker rate-limit `POST /api/tutor/turn` and `/api/speech/token` to prevent accidental expenses, even though there is only one user.

### 4.2 Network/offline behavior
- HTTPS required for microphone access; request permission only on first speech attempt.
- PWA caches app shell, icons and selected non-sensitive content, but **does not promise offline AI, Azure speech, or authenticated API operations**.
- Display “Connection required for voice conversation” if offline; allow reading a previously cached lesson and typing draft answers locally; synchronize only once API succeeds.
- If the browser suspends during a phone call or lock-screen transition, save completed turns on server. Show resume/retry controls without creating duplicate turns.

### 4.3 Cost governance
- Default **app-level soft warning at US$5/month** and **stop paid AI requests when estimated tracked usage reaches US$10/month**; values editable in Settings. The internal stop is not a provider-enforced maximum—external provider quotas/billing limits should also be configured when available.
- Persist per-call provider, model, input/output tokens, reported or estimated audio seconds, TTS characters, calculated estimate and status in `usage_events`.
- Track Azure free-tier usage separately. The currently documented Azure F0 allocations are **5 audio hours/month transcription** and **500,000 neural TTS characters/month**; actual account quotas and pronunciation-feature prices must be verified in the Azure portal before live launch.
- No auto-upgrade to paid Azure tiers; stop or switch to manual text input when configured limits are reached.
- Log no raw audio, no API secrets and no full prompt bodies by default. Let the owner delete conversations and exports.

---

## 5. UX routes and feature requirements

### 5.1 `/onboarding` — P0
Inputs: preferred nickname (optional), current self-rated comprehension/speaking, optional HSK level (not treated as proven), session duration (15, 20, 25, 30), Simplified default, captions/pinyin help level, normal speech rate (0.75–1.15), colloquial intensity (`low|normal|high`), time zone (auto-detected, user-editable), API provider availability.

Onboarding includes a **brief placement sample** (P1 for full automation; P0 allows skip): 1–2 listening questions, 2 reading items, 1 response prompt. Its outcome is a *provisional recommended starting level*, not an HSK certification claim.

**Acceptance:** On another logged-in device the same settings appear; first visit shows “curriculum not imported” rather than misleading percentage when no real data has loaded.

### 5.2 `/` — Dashboard — P0
Show today's session button, minutes target and completed, recent sessions, “resume incomplete”, due reviews, current **study band**, monthly provider usage, and two distinct cards:
- **HSK curriculum**: verified imported entries, practiced entries, mastered-by-skill entries, coverage percentages with denominator and source edition.
- **Communication progress**: weekly listening checks, successful turn completion, words/minute where measurable, independent speech prompt score trends with provenance.

Do not infer actual fluency or HSK test readiness from a streak.

### 5.3 `/session/:sessionId` — Guided immersion — P0
A session is a sequence of activities on a **single communicative theme** (e.g. organizing dinner plans) with connected vocabulary:
Every session follows this spine, in this order, all set in the session's topic and aimed at its task:
1. **Warm-up retrieval:** 2–4 due cards or last session's corrections, answered before anything new.
2. **Listen first** to a new short exchange carrying out the task, containing at least one instance of each target grammar point and at least half the new target words; no default translation; optionally replay slower, show pinyin or transcript *after an attempt*. The generated script is checked against the plan before use.
3. **Notice:** the transcript with the target words and the grammar pattern highlighted, the grammar point's name and one syllabus example (labelled unverified where it is); the target characters shown inside their words.
4. **Read:** a short new text in the same topic reusing the targets, answered before any translation is shown.
5. **Guided practice:** 2–3 controlled prompts that require the grammar point and target words (e.g. complete, transform, answer with the pattern), spoken or typed, with immediate feedback.
6. **Conversation that carries out the task** with the AI, turn-based. Press-and-hold or tap-to-record, status cues for listening/processing/speaking; finish automatically after silence or manually. The tutor elicits any target grammar not yet used (§6.3).
7. **Write:** a short typed response that completes the task in writing and must use the grammar point; checked against stated criteria.
8. **Summary:** 1–3 high-impact corrections (each becoming a card and a next-session priority, §2.5 rule 7), the task check result, targets met, and what comes back when.

The plan JSON lists every step with its targets, so a session can be checked for completeness.

Controls: replay, speed, transcript reveal, optional English help, repeat last prompt, skip/hide, pause and resume, report wrong feedback, toggle “more natural speech”. Never interrupt every sentence for corrections; use recasts during speaking, coaching during debrief.

**Duration allocation target for 25 minutes:** warm-up 3, listen 4, notice 2, read 3, guided practice 3, conversation 7, write 3 (summary is read afterwards). For 15 minutes: 2, 3, 1, 2, 2, 4, 1. The planner shifts up to 20% of the time toward the owner's weakest skill (§6.2) without dropping listening and speaking below 40% combined; aim ~55–70%. Timing is a guide, not a hard auto-stop.

**Natural conversation:** AI can use common discourse markers (`那个`, `就是`, etc.) where appropriate, paraphrases, colloquial phrasing, everyday pace and filler words. Do not fill beginner audio with unnatural slang. All slang introduced must be labeled colloquial with social register/context.

**Acceptance:** complete a 20-minute session with a live microphone on a phone and with a keyboard on desktop; save each turn exactly once on retries; allow text fallback if microphone denied.

### 5.4 `/curriculum` and `/curriculum/:band` — HSK map — P0
- List HSK 1–6 and shared 7–9 with imported verified counts, introduced, practiced, listening-known, reading-known, speaking-known, writing-known, and reviewed/mastered counts.
- Filter by topic, part of speech, first-introduction level, learned/not learned, and overdue items.
- Click an item for Hanzi, syllabus pinyin, optional sourced gloss, example(s), variants/homographs, recorded evidence and source link/page; clearly distinguish generated examples from official content.
- Import-status banner for unavailable grammar/topics/tasks/characters; **never silently report 100%** for missing categories.
- Each band page browses all five sections: vocabulary, grammar (kind, category, syllabus examples), characters (to recognise / to write), topics (area, subject, coverage) and tasks (can-do statements), each with search, learner state and source credit (§2.5). Rows from an unverified section have a “flag as wrong” control (§2.5 rule 8).
- No HSK score or badge unless backed by a named assessment and method.

### 5.5 `/review` — P0
- Review due vocabulary from FSRS with varied **recognition and recall** prompts (audio→meaning, character→meaning, meaning→spoken response, phrase application). Avoid simple multiple choice as the only route to mastery.
- Label prompts by skill. Spaced repetition schedule is per item+skill (or per card template), not one universal “word learned” flag.
- Review ratings: Again / Hard / Good / Easy, recorded by user or explicit assessment, mapped to FSRS. AI qualitative feedback is supportive but **must not automatically mark mastery**.
- Rate limit newly introduced vocabulary per day by setting, default 5–8; emphasize repeated meaningful exposure over hoarding words.
- Grammar cards: understand a syllabus example (listening, reading) and produce a sentence using the point (speaking, writing). Character cards: recognise the character shown in 1–3 words that contain it, preferring words already met; produce it by typing from a pinyin-and-meaning prompt or by copying a shown model and rating yourself — named “typed” or “self-rated”, never “handwriting”. Speaking prompts are answered aloud; a typed answer is accepted but recorded as writing, not speaking. Cards come from items targeted in a finished session and from summary corrections.
- **Recognition and production are separate.** Reading and listening cards are recognition; speaking and writing cards are production. Production skills reach `developing` or `mastered` only from production cards, guided-practice prompts, task-check criteria or test items, never from recognition cards.

### 5.6 `/progress` — P0
Charts: rolling 7/30 day practice minutes, skill-specific practice coverage, objective listening accuracy (unseen recordings/questions), speaking-turn completion, average self-rating, mastered HSK vocabulary entries by skill, recent mistakes/repetition hotspots. Show actual denominator, assessment dates, and sample size; use “insufficient evidence” when <5 qualifying observations.

Show weekly **skill balance** (minutes and qualifying attempts per skill) and **meaningful days** (§8.3), and tasks achieved per band.

**HSK readiness:** per band a coverage profile for verified sections rather than a pass/fail prediction, plus separately labelled profiles for unverified sections (§2.5) and results of band practice tests (§6.5). **Conversational fluency:** separate longitudinal tasks on *unseen* prompts and audio; do not let familiar practice transcripts contaminate benchmark scores.

### 5.7 `/settings` — P0
Owner preferences, AI provider model, speed, pinyin/translation reveal rules, default duration, slang intensity, text/mic fallback, privacy/log retention, export JSON/CSV, deletion, monthly soft/hard limits, data source and import manifest, attribution/licenses, build version. All settings persist to D1. Explicitly label if a feature requires a paid/third-party account.

### 5.8 P1 extras
- Imported/recorded native human audio with suitable license; multiple conversational speakers, accent/register/dialect notes; difficulty calibrated by speech rate and lexical density.
- Benchmark speech samples, repeat-after-me shadowing, dedicated `zh-CN` pronunciation drills.
- Offline review caching with indexedDB and safe reconciliation; notifications on user-selected schedule (opt in), calendar history.
- Topic personalization (food, errands, travel, work, family, media) and manual vocab bookmark import.

---

## 6. Learning logic, progression and evidence model

### 6.1 Distinguish exposure from ability
Store five mutually distinguishable states at a skill-specific level:
- `unseen`: no validated exposure;
- `introduced`: appeared in a lesson;
- `practiced`: learner made at least one attempt;
- `developing`: at least one correct qualifying recall but not enough spaced evidence;
- `mastered`: configurable minimum of **3 successful recall attempts on different days**, including at least one delayed review (≥24 hours after introduction) for that specific skill and item.

The above mastery threshold is a product-defined *heuristic*, not an official HSK requirement. It applies to every item type: grammar points use all four skills; characters use reading (recognise) and, when on the band's writing list, writing; topics have no mastery state, only an exposure count. A **task check** has 2–3 yes/no criteria derived from the task's can-do statement (e.g. “stated a time”, “proposed an alternative”), stored with the session and judged against the conversation transcript and the written answer by a rubric with a stored scorer version. A task is `achieved` after passing on two different days, at least one in a topic other than the first; it is labelled a personal can-do check, not an HSK task result. Failed recall can lower the mastery state; do not reset historical evidence. Progress denominator = valid imported numbered source entries at the current edition / selected band, with explicit distinction between cumulative vs newly introduced.

### 6.2 Daily planner (`planDailySession`)
Deterministic inputs: owner's settings, current local date, available minutes, imported HSK bands, due FSRS reviews, mastery evidence, weak skills, topic repetition, last N sessions, offline/provider state.

1. Select target band: onboarding/placement or manually pinned by owner. If none, start HSK 1 as a **study suggestion**, not a measured level.
2. Select targets in this fixed priority until the caps are reached: (a) items corrected or failed in the last 3 sessions, at most 3; (b) items in `introduced`/`practiced`/`developing` that are due, weakest skill first, re-targeted 2–7 days after their last session in a **different topic**; (c) new items at the study band, up to the daily-new limit; (d) stretch content, 0–20%. Caps per session: 3–8 vocabulary targets with at most 5 new; at most 1 new and 1 recycled grammar point (verified, or imported unverified under §2.5); a 15-minute session has at most 1 grammar point and no slang. Put ≥50% of targets in the active level. Add the target words' characters on the band's lists, and up to 3 more band characters that appear in words already met. Rows flagged as wrong are never selected.
3. Pick one task of the study band not achieved yet and not used in the last 3 sessions, and a topic of the band that fits it and differs from the topics in which the recycled items were introduced. The task's can-do statement is the session goal (§2.4).
   *Weakest skill* = the skill with the lowest share of qualifying successful attempts over the last 14 days (ties: fewest attempts); it receives the time shift in §5.3. When the topic and task catalogues are not imported, use a small **clearly authored** local situation list with `source_type=app-authored`, not fake HSK task IDs.
4. Choose up to 1 slang expression in sessions of 20 minutes or more (more only when learner opts in); warn if texting-only, regional, rude, or fading.
5. Assemble timeboxed activities and persist `session_plan` as JSON referencing valid IDs; subsequent model requests can only use this plan and related persisted context.
6. If there is no imported syllabus, block official level scoring and display setup guidance; allow **uncategorized free chat** optionally, never pseudo-HSK lessons.

### 6.3 Tutor behavior / prompt requirements
Tutor should respond primarily in natural Mandarin, tuned to comprehension; speak in the role of an everyday conversational partner rather than a quiz bot. Ask one relevant follow-up per turn. Never make an HSK classification without a matching imported item ID. Adjust difficulty when the learner requests help or repeatedly fails to comprehend. Provide English only on request or as a debrief aid.

Rules enforced in server-side prompt and validation:
- The selected `target_item_ids` are supplied by the planner and are immutable for the session.
- Use source words naturally; don't forcibly include all targets in one utterance.
- The tutor receives the target grammar points (name, pattern, one example) and the task. Each reply reports `used_grammar_ids` and `elicited_grammar_ids`; the server keeps a claimed id only if the point's pattern is found in the reply. If a planned point has been neither used nor elicited by the learner's 4th turn, the next reply must elicit it. Whether the learner used each point is recorded as a guided-practice or conversation attempt for that point and skill.
- `spoken_reply_zh` is 1–3 concise sentences for beginner dialogue and grows with proficiency; avoid unnatural literary prose.
- Feedback differentiates actual user transcript, semantic errors, grammar errors, and *possible* recognition uncertainty. Do not interpret low-confidence transcription as proof of learner error.
- Provide 1–3 corrections after a conversation chunk or session, not a score on every utterance.
- For colloquial speech use source-specific tags and explain appropriateness, tone, and whether spoken vs typed.
- Prompt injection in learner text must not override instructions or request secrets. Treat learner text as untrusted content.

### 6.4 Model output contract (validate with Zod, retry once)

```json
{
  "spoken_reply_zh": "你周末一般喜欢做什么？",
  "optional_pinyin": "Nǐ zhōumò yìbān xǐhuan zuò shénme?",
  "optional_translation_en": "What do you usually like to do on weekends?",
  "referenced_curriculum_item_ids": ["hsk3-2025-11:vocab:42"],
  "referenced_colloquial_ids": [],
  "used_grammar_ids": [],
  "elicited_grammar_ids": [],
  "semantic_feedback": {
    "understood_intent": true,
    "corrections": [],
    "encouragement_zh": "不错！"
  },
  "suggested_followup_topic": "weekend plans"
}
```

This is **an illustrative shape only**. Build a shared Zod schema and infer TypeScript types. Reject invented IDs, overlong strings, malformed JSON or English-only dialogue when target is Mandarin. If the model fails twice, return a safe predetermined conversational fallback using a locally approved prompt, and don't record incorrect artificial feedback.

### 6.5 Objective evidence — P0
- Listening score: attempt on unseen audio prompt before transcript reveal; score against stored expected answer/rubric; source and number of questions recorded.
- Speaking: number of spontaneous turns, duration and learner self-rating, plus optional human/AI qualitative feedback; **do not call ASR transcript correctness a pronunciation score**.
- Writing: prompt completion, rubric-based feedback with confidence/provenance; persist original answer and edits.
- Reading: unseen comprehension prompt answered before translation reveal.
- HSK lexical skill mastery: recall attempts by skill + FSRS schedule; passive appearance is not mastery.
- Monthly checkpoint: at least 1 unseen listening and 1 unseen spontaneous speaking task, comparable rubric and topic difficulty, store model/scorer version. Scores are *personal tracking*, not standardized HSK exam scores.
- Band practice test (P0 under §2.5): a fixed-length test per band built deterministically from imported items (vocabulary, grammar, characters; passages framed by band topics and tasks), with listening, reading and writing parts. Questions are generated from stored items and checked against them; test passages carry out band tasks in band topics, so results also count as transfer evidence; answer keys built from unverified examples are labelled “unverified key”, and flagged rows are never used; answers are scored by fixed keys where possible and by a rubric with stored scorer version otherwise. Store the run in `assessment_runs` with item ids, per-section scores and sample sizes. Correct answers count as recall evidence for mastery; the result is never called an HSK score or pass.

---

## 7. Speech integration details

### 7.1 P0 audio pipeline
1. PWA requests microphone permission (`getUserMedia`) only when needed; display clear permission and device-mic troubleshooting guidance.
2. Worker verifies owner and monthly budget, then issues Azure short-lived speech token from `/api/speech/token`; secret key remains server-side.
3. Browser Azure Speech SDK with `speechRecognitionLanguage=zh-CN` records a short utterance and returns final transcript + available recognition confidence metadata.
4. Submit transcript and text context to `/api/sessions/:id/turn` with a stable `client_turn_id` UUID, so retries cannot create duplicate records.
5. Worker fetches actual target curriculum items from D1, calls OpenAI Responses API (text only), validates structured result, saves turn and model usage, then returns reply text and coaching metadata.
6. Browser synthesizes the reply through Azure neural TTS (`zh-CN`, configurable voice/rate); enable a browser `speechSynthesis` fallback only with clear “device voice quality may vary” notice.
7. The owner can replay and toggle **transcript after attempting comprehension**.
8. Stop microphone tracks and release speech resources on cancel, navigation and app backgrounding. Do not persist raw audio in P0.

### 7.2 P0 text fallback
If microphone permission, Azure service, device SDK support, or quota fails, allow typed Mandarin answers and still complete the session. Distinguish typed turns from spoken turns in analytics; don't imply a speaking practice occurred.

### 7.3 P1 pronunciation assessment
Use Azure's `zh-CN` Pronunciation Assessment only for **known-reference short utterances** and expose the returned supported metrics (for example accuracy/fluency), with a clear confidence caveat. Do not promise tone-specific precision, syllable groups, comprehensive spontaneous conversational scoring, or English-only speech-learning features for Mandarin. Evaluate on devices and non-native recordings before promoting scores to the dashboard.

### 7.4 Speech edge cases
- No transcript / silence -> ask to retry, **no automatic failure**.
- Transcript low confidence -> offer editing or confirmation; mark `transcript_uncertain`.
- Network interruption -> client resubmits by idempotency key; server returns prior result if already committed.
- TTS fails -> show text and replay button; don't discard saved turn.
- Background suspension -> pause; no invisible background recording.
- Do not use one long continuous Azure transcription stream when push-to-talk suffices; speech minutes are usage-metered.

---

## 8. Database schema (D1 / SQLite)

Use Drizzle SQL migrations, ISO-8601 UTC timestamps, explicit indexes, FK constraints (`PRAGMA foreign_keys=ON`), IDs as `TEXT` UUIDs except source numeric IDs. This is the **logical minimum**, not a demand to split tables unnaturally; implementers can add join tables for clean SQL. **No raw audio BLOB** in D1.

### 8.1 Core reference tables

| Table | Key fields | Constraints / indexes |
|---|---|---|
| `curriculum_editions` | `id` PK (`hsk3-2025-11`), `publisher`, `edition_date`, `is_active`, `notes` | Unique edition id; never mutate historical identity |
| `source_manifests` | `id`, `edition_id`, `dataset_kind`, `source_url`, `commit_sha`, `sha256`, `rights_note`, `imported_at`, `record_count` | `edition_id` FK; index on edition/kind |
| `curriculum_items` | `id` PK (`edition:type:sourceId`), `edition_id`, `source_id`, `item_type` (`vocab`,`grammar`,`character`,`topic`,`task`), `hsk_band`, `hanzi`, `entry_raw`, `pinyin`, `part_of_speech`, `homograph`, `level_label`, `source_pdf_page`, `definition`, `definition_provenance`, `metadata_json` | Unique `(edition_id,item_type,source_id)`; index `(edition_id,item_type,hsk_band)` |
| `colloquial_expressions` | `id`, `term`, `pinyin`, `meaning_en`, `register`, `channel`, `region`, `currency_status`, `last_verified_at`, `source_url`, `license`, `attribution`, `verification_status` | Unique `(source_url, term)` or stable source slug; never counted in HSK |

`curriculum_items.hsk_band`: ENUM-like `TEXT CHECK (... IN ('1','2','3','4','5','6','7-9'))`. Preserve original `level_label` separately. Definitions may be null. Exclude any not-yet-verified structured `grammar`/`topic`/`task` import from official coverage metrics.

### 8.2 Learner and session tables

| Table | Key fields | Notes |
|---|---|---|
| `owner_settings` | `owner_id` PK, `locale`, `timezone`, `session_minutes`, `study_band`, `display_mode`, `speech_rate`, `slang_intensity`, `limits_json`, `updated_at` | Exactly one owner; access identity must match |
| `sessions` | `id` PK, `owner_id`, `edition_id`, `local_study_date`, `duration_target_min`, `started_at`, `ended_at`, `status`, `plan_json`, `actual_seconds`, `model` | `status`: planned, active, paused, complete, abandoned |
| `conversation_turns` | `id`, `session_id`, `client_turn_id`, `source_mode` (`speech`,`typed`), `asr_text`, `asr_uncertain`, `ai_reply_zh`, `ai_reply_json`, `created_at` | Unique `(session_id, client_turn_id)` for idempotency; no audio bytes |
| `practice_attempts` | `id`, `session_id`, `curriculum_item_id` nullable, `colloquial_id` nullable, `skill` (`listening`,`speaking`,`reading`,`writing`), `assessment_type`, `prompt_id`, `user_response`, `score`, `score_source`, `is_qualifying_recall`, `attempted_at` | Check one source ID or authored prompt; index `(curriculum_item_id,skill,attempted_at)` |
| `mastery_states` | `owner_id`, `curriculum_item_id`, `skill`, `state`, `first_seen_at`, `last_attempt_at`, `last_success_at`, `success_days`, `failure_count`, `updated_at` | Composite PK `(owner_id,curriculum_item_id,skill)`, derived from evidence |
| `review_cards` | `id`, `owner_id`, `curriculum_item_id`, `skill`, `template`, `fsrs_state_json`, `due_at`, `updated_at` | Index `(owner_id,due_at)` |
| `review_events` | `id`, `review_card_id`, `rating`, `elapsed_days`, `state_before_json`, `state_after_json`, `created_at` | Append-only schedule audit |
| `assessment_runs` | `id`, `owner_id`, `edition_id`, `rubric_version`, `started_at`, `finished_at`, `metadata_json`, `results_json` | Unseen prompt IDs and sample size required |
| `usage_events` | `id`, `provider`, `operation`, `model`, `tokens_in`, `tokens_out`, `audio_seconds`, `tts_chars`, `estimated_usd`, `recorded_at`, `status` | index `(recorded_at,provider)` |

If the owner changes syllabi, keep mastery keyed by edition. Provide an optional explicit future mapping tool for moving evidence across editions; **never automatically migrate learning scores by matching Hanzi**.

### 8.3 Analytics formulas
- `HSK band coverage by skill = count(distinct mastered source item IDs first-introduced ≤ selected band in applicable range) / cumulative source entry count`.
- `Introduced count = distinct IDs with a session reference`, not all words presented to the LLM.
- `Practice minutes = sum(actual_seconds) / 60`; cap client event durations and prevent duplicate accounting.
- `Meaningful day` = a local calendar date (owner time zone) with at least one oral or written production attempt and at least one retrieval (review card or warm-up). Show meaningful days per week instead of a streak; minutes alone never make a day meaningful.
- `Skill balance` = qualifying attempts per skill per week, shown together.
- `Listening accuracy = correct answers / attempted unseen questions` and show `n`.
- `Section coverage by skill` (grammar, characters) uses the same formula with that section's imported rows as the denominator, labelled unverified when its manifest is; topics and tasks report `practised / imported` per band.
- `AI feedback != official HSK score`; no fake CEFR alignment or guaranteed fluency timeline.

---

## 9. API contract (JSON over HTTPS)

General rules: prefix `/api/v1`; all routes require Access auth except `/api/v1/health` (return only safe status, no user info). JSON request/response are Zod-validated. Use `Authorization` handled by Cloudflare Access cookies/JWT—not DIY plaintext access tokens. For mutations, accept `Idempotency-Key` or entity `client_*_id`. Error JSON:

```json
{"error":{"code":"CURRICULUM_MISSING","message":"Import the HSK 3.0 vocabulary data before starting a guided HSK session","retryable":false}}
```

| Method / path | Request or purpose | Response essentials |
|---|---|---|
| `GET /health` | Public, no PII | app version, boolean ready; no secret or DB details |
| `GET /me` | Authenticated settings, source state | owner settings, enabled providers |
| `PUT /settings` | Whitelisted preference fields | updated settings + timestamp |
| `GET /curriculum/status` | Active edition, source manifests | counts by type, missing/verified flags |
| `GET /curriculum/items?band=1&type=vocab&state=unseen&cursor=...` | Paginated source items | items + stable cursor; do not return full corpus at once |
| `GET /curriculum/items/:id` | One source entry | full provenance, progress state |
| `POST /sessions/plan` | `{durationMinutes: 20, studyBand: "2"}` optional | validated plan + newly created session ID |
| `GET /sessions/:id` | Saved session | plan, turns, current status, resumable activity |
| `POST /sessions/:id/turn` | `{clientTurnId, transcript, sourceMode, asrUncertain}` | AI reply, valid referenced IDs, feedback, usage info |
| `PATCH /sessions/:id` | pause/resume/abandon | server state |
| `POST /sessions/:id/complete` | idempotent completion | minutes, practiced IDs, review recommendations |
| `POST /speech/token` | provider health and quota check | Azure ephemeral token, region, expiry; no long-term key |
| `POST /attempts` | assessment/recall evidence | attempt id, computed new mastery state |
| `GET /reviews/due?limit=20` | Fetch due cards | card + prompt metadata |
| `POST /reviews/:id/rate` | `{rating:"good",clientEventId}` | next due, FSRS state |
| `GET /progress/summary?days=30` | trend + curriculum counts | metrics with denominator, sample size, date window |
| `POST /assessments/start` | choose unseen benchmark form | questions/steps, assessment id |
| `POST /assessments/:id/finish` | answer set and evidence | non-official skill results, rubric version |
| `GET /usage/monthly` | internal spend counter | reported + estimated spend, remaining budget |
| `GET /export?format=json` | User data export | redacted provider secrets, versioned schema |
| `GET /export?format=csv` | Zip or per-entity CSV | human-readable data |
| `DELETE /sessions/:id` | Delete user session and turns | deletion confirmation after auth |
| `DELETE /my-data` | Optional explicit double-confirm owner wipe | summary of deleted records; do not delete curriculum reference tables |

**Example turn input:**

```json
{
  "clientTurnId": "1ce823bc-4f1a-46d7-91ba-a211649eac3a",
  "transcript": "我周末想跟朋友去吃火锅。",
  "sourceMode": "speech",
  "asrUncertain": false
}
```

**Example successful response:**

```json
{
  "turnId": "generated-uuid",
  "sessionId": "existing-session-uuid",
  "reply": {
    "spokenZh": "听起来不错！你们打算去哪家店？",
    "pinyin": "Tīng qǐlái búcuò! Nǐmen dǎsuàn qù nǎ jiā diàn?",
    "translationEn": "That sounds good! Which place are you planning to go to?"
  },
  "referencedCurriculumItemIds": ["hsk3-2025-11:vocab:42"],
  "feedback": {"corrections": [], "transcriptUncertain": false},
  "usage": {"estimatedUsdThisTurn": 0.0003}
}
```

All response fields shown are illustrative. Validate the linked curriculum ID **against the actual imported row**; the sample ID is not proof that the example phrase is assigned to that item. If the model chooses a non-matching item ID, remove/reject the reference without assigning fake mastery.

### 9.1 Error handling
- `401/403` authentication/owner mismatch; `400` bad schema; `404` missing resource; `409` session completed / state conflict; `429` request/usage limit; `503` provider or curriculum unavailable.
- Retry only idempotent operations or mutations with idempotency keys; exponential backoff with ≤2 retries.
- Provider timeout 15–25 seconds; show an explicit recoverable error and keep already saved input; never charge usage twice in local accounting.
- Don't include raw provider errors, keys, authentication cookies or prompts in returned failures.

---

## 10. UI component and accessibility contract

Main pages: `DashboardPage`, `SessionPage`, `CurriculumPage`, `CurriculumItemPage`, `ReviewPage`, `ProgressPage`, `SettingsPage`, `OnboardingPage`.

Reusable components: `AudioRecordButton`, `AudioPlaybackBar`, `MandarinText` (Hanzi, lazy pinyin, optional translation), `ConversationBubble`, `CorrectionPanel`, `HSKBandProgress`, `MasteryBySkill`, `DailyGoalMeter`, `SkillEvidenceChart`, `SourceAttribution`, `UsageBudgetMeter`, `OfflineBanner`, `AsyncStatus`, `ConfirmDeleteDialog`.

- Mobile-first responsive design: ≥320 CSS px; desktop should not stretch chat to unreadable width; bottom recording control reachable with thumb.
- WCAG-inspired AA targets: keyboard operation for all primary controls, visible focus, contrast, descriptive labels, live-region updates for record/transcribe status. No information conveyed only by color.
- All Chinese text must render in capable CJK fonts with fallback; use Unicode and distinguish tone marks from source pinyin.
- `prefers-reduced-motion` honored; microphone status must be textual and visual.
- Save transcript reveal action separately to calculate **unassisted** comprehension; don't equate seeing captions with listening success.
- Do not show a “100% fluent” meter. Percentages have precise denominators and meaningful labels.

---

## 11. Functional acceptance criteria / test matrix

| ID | Priority | Scenario | Pass condition |
|---|---|---|---|
| FR-001 | P0 | First launch on mobile and desktop | Responsive UI, PWA install manifest, no JS exceptions |
| FR-002 | P0 | Single-owner restriction | Unauthorized visitor cannot load protected app/API or mint speech tokens |
| FR-003 | P0 | Official vocabulary import | Exactly 11,000 numbered source IDs; counts by band match §2; idempotent re-import |
| FR-004 | P0 | Tampered dataset | Duplicate ID/wrong level/wrong total fails atomically and shows actionable error |
| FR-005 | P0 | No HSK data available | Block HSK-gated lesson, show import instructions; optional unlabeled chat remains available |
| FR-006 | P0 | Lesson planning | Persist valid source IDs, edition, communicative goal and per-activity time budget |
| FR-007 | P0 | AI hallucinates wrong HSK level | Validator prevents the fabricated mapping and prevents incorrect mastery credit |
| FR-008 | P0 | Short Mandarin voice turn | Transcribed, persisted, answered audibly and by text; transcript may be revealed |
| FR-009 | P0 | Microphone denied | Typed fallback; typed minutes not counted as actual speaking evidence |
| FR-010 | P0 | Page reload during conversation | Resume session and existing turns without duplication |
| FR-011 | P0 | Duplicate network submission | Same `clientTurnId` returns same previously committed result |
| FR-012 | P0 | Missing speech/LLM key | Mock/dev works, production shows actionable provider setup state; no blank screen |
| FR-013 | P0 | 15/20/25/30-minute plan | Valid plans with listening, speaking, reading, review/writing; primary emphasis on oral skills |
| FR-014 | P0 | Vocabulary review | FSRS ratings schedule due review, durable history survives redeploy |
| FR-015 | P0 | Mastery reporting | Exposure alone does not equal mastery; distinct evidence per skill |
| FR-016 | P0 | HSK coverage | New/cumulative counts explicit, 7–9 shared, missing grammar never shown as verified |
| FR-017 | P0 | Slang source | Register/channel/credit shown; slang omitted from official HSK counts |
| FR-018 | P0 | Monthly cost guard | Usage metered; at configured stop threshold no further billable tutor requests |
| FR-019 | P0 | Data export | Download complete valid JSON/CSV and re-import in local test environment |
| FR-020 | P0 | Device switching | Session history, settings and progress consistent across authenticated devices |
| FR-021 | P1 | Pronunciation drill | `zh-CN` reference phrase assessed; label service limits and don't grade spontaneous tones |
| FR-022 | P1 | Monthly unseen checkpoint | Comparable listening/speaking form recorded with sample size and scorer version |
| FR-023 | P0 | Browse every section | Grammar, characters, topics and tasks listed and searchable by band, with details and source credit |
| FR-024 | P0 | Connected lesson plan | Plan follows the §5.3 spine with targets per step, the §6.2 priority, caps and topic change for recycled items; ids only from the database; ids outside the plan are dropped |
| FR-028 | P0 | Grammar in use | Listening script contains each target pattern; tutor's grammar claims checked against reply text; an unused point is elicited by turn 5; learner use recorded as an attempt |
| FR-029 | P0 | Feedback flows forward | Each summary correction creates or advances a card and is priority 1 in the next plan |
| FR-025 | P0 | Section review | Grammar and character cards (characters shown in words) created from finished sessions and corrections, rated with FSRS, history kept; production mastery only from production evidence |
| FR-026 | P0 | Section progress | Mastery per section and skill from evidence; unverified sections labelled and kept apart from verified coverage |
| FR-030 | P0 | Task check | 2–3 criteria per task judged with a stored scorer version; achieved after two passes on different days in different topics |
| FR-031 | P0 | Flag as wrong | A flagged unverified row leaves plans, cards and test keys and is listed with its note |
| FR-027 | P0 | Band practice test | Deterministic test per band from imported items, scored and stored with sample sizes; feeds mastery; never presented as an HSK score |

---

## 12. Security, privacy and reliability requirements

**SEC-01:** Official deployment must be Access-protected including preview URLs, and the API must verify an authenticated principal belongs to the single owner.

**SEC-02:** Secrets (`OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, relevant Cloudflare binding secrets) only in encrypted runtime environment; `.env.example` has placeholder names, never values. Prefer Cloudflare secrets over plaintext deployment configuration.

**SEC-03:** Speech tokens short lived and never stored permanently. No audio files stored in MVP. Text transcripts retained until deleted by owner; include a configurable retention policy.

**SEC-04:** Restrict input size (e.g. <=4,000 transcript characters / turn), output size, session turn count and provider requests. Escape displayed text; avoid HTML render of model output. Use basic Content Security Policy suitable for Azure/OpenAI origins and HTTPS.

**SEC-05:** Back up/export D1 data regularly through manual export or owner-controlled workflow; recovery guide must say what is backed up. Document Cloudflare D1 Free's 500 MB per-database limit and daily query quotas. Track size; avoid logging long chat history verbatim.

**SEC-06:** Never collect payment, contacts, GPS or other unrelated personal data. Show which third-party processors receive typed/audio inputs. Permit deletion of conversation history independently of HSK reference data.

**REL-01:** Session turns and review events append durably and idempotently. In-progress sessions survive page refresh and 1-minute network outages.

**REL-02:** Provider errors degrade gracefully to typed mode or locally prepared text activity; don't mark a failed provider operation as successful speaking practice.

**REL-03:** Build process produces a deployable artifact and migration scripts; use versioned DB schema and transactional upgrade path. Pin package versions and run `pnpm audit` or equivalent in CI.

**PERF-01:** Aim for cached dashboard first paint under ~2 seconds on good mobile connection, API non-LLM reads p95 under ~500 ms excluding network; voice AI latency is provider dependent and should display intermediate state rather than promise fixed SLA.

**PRIV-01:** Never forward user transcripts to additional vendors without explicit configuration. Separate transcript retention from telemetry and implement owner deletion.

---

## 13. Repo structure, conventions and commands

Suggested single-repository layout:

```text
chinese-immersion/
  README.md
  SPEC.md                         # This document, source of truth
  CLAUDE.md                       # Implementation workflow and constraints
  package.json
  pnpm-lock.yaml
  wrangler.jsonc
  .env.example
  .gitignore                      # .dev.vars, private-data, exports, secrets
  src/
    client/
      main.tsx
      app/
      pages/
      components/
      hooks/
      styles/
    server/
      index.ts                     # Hono API Worker
      routes/
      services/                   # planner, tutor, reviews, progress, imports
      providers/                  # OpenAI adapter, Azure token issuer
      auth/
      db/
        schema.ts
        migrations/
      validation/
    shared/
      api.ts                       # Zod contracts and shared types
      curriculum.ts
      learning.ts
  scripts/
    import-curriculum.ts
    verify-curriculum.ts
    seed-dev-fixtures.ts
  test/
    unit/
    integration/
    e2e/
    fixtures/                     # tiny synthetic fixtures, no complete HSK text
  public/
    manifest.webmanifest
    icons/
  docs/
    SETUP.md
    ARCHITECTURE.md
    DATA_SOURCES.md
    PRIVACY.md
    COSTS.md
  private-data/                    # local only, ignored
```

Required scripts (names may be adapted but document any changes):

```bash
pnpm install
pnpm dev                      # local UI + API + D1 emulation
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm db:migrate:local
pnpm db:migrate:remote
pnpm curriculum:import --source ./private-data/hsk-vocab --edition hsk3-2025-11
pnpm curriculum:verify
pnpm deploy
```

`README.md` must contain step-by-step setup for Cloudflare, D1, Cloudflare Access, OpenAI API account, Azure Speech F0 account, `.dev.vars` local secrets, production secrets, first curriculum import, migrations, test commands, deployment, iOS/Android install, budget limits and backup/export. **Do not assume Claude Code is logged into any of these accounts.**

`CLAUDE.md` must instruct the coding agent to (1) read `SPEC.md`, (2) maintain a checklist of implemented P0 FR IDs, (3) run typecheck/tests after each phase, (4) never mark integration successful without actual provider credentials and manual mic testing, and (5) ask only for unavoidable external account authorizations or credentials.

---

## 14. Test strategy and evaluation fixtures

### 14.1 Unit tests
- HSK import counts, cross-edition isolation, homograph identity, duplicate detection, missing page/labels, idempotent imports.
- Valid/invalid generated curriculum IDs, grammar/source optionality, no slang in official HSK denominator.
- Mastery state changes from spaced recall and non-success; exposure never creates mastery.
- FSRS next-due determinism with seeded clock and immutable review event history.
- Duration allocation for 15/20/25/30 minute plans, difficulty and topic selection with seeded date.
- Accurate per-provider usage, limit checks, and lower/upper budget guard behavior.

### 14.2 Integration tests
- Real local D1-compatible migration, planner queries, `POST /sessions`, turn idempotency, export-import roundtrip, deletion, auth rejection.
- Mock AI JSON that returns fabricated HSK IDs or hallucinated definitions: backend rejects/strips invalid official mappings.
- Azure token endpoint returns `{token,region,expiresAt}` without resource key, denies unauthorized caller.
- Failed OpenAI call retains existing user turn and returns retryable error without a phantom AI response.

### 14.3 Browser e2e (Playwright)
- Dashboard, onboarding, lesson and review routes; 320px mobile viewport and desktop widths.
- PWA manifest and service worker registered in production build.
- Mocked microphone and speech providers to complete 20-minute logical session; typing fallback test.
- Test caption gating, focus order, keyboard accessibility, recovery from refresh and error banners.

### 14.4 Manual verification checklist (owner-provided credentials/devices)
- Real iOS Safari home-screen PWA, Android Chrome PWA, Windows/macOS desktop browser where available.
- `zh-CN` speech-to-text in quiet and noisy environments, normal/speaking-rate changes and silence.
- Azure TTS naturalness, interruption/stop behavior, token refresh on sessions lasting >10 minutes.
- Actual Claude Code instructions can be followed from a clean clone without undocumented manual steps.
- Compare at least 20 Mandarin dialogue prompts against expected casualness, meaning, follow-up relevance and HSK tagging; use structured evaluation notes, not unsupported “native quality” claims.

---

## 15. Known constraints and explicit technical decisions

1. **Curriculum reliability beats convenience.** Don't build a system that quietly invents official HSK words or levels.
2. **Audio quality is the main integration risk.** Azure supports `zh-CN` recognition, TTS, and pronunciation assessment; actual mobile SDK compatibility, free-tier coverage and specific prosody/tone granularity need real tests.
3. **HSK 3.0 lexicon is not an English dictionary.** Glosses must have separate provenance; they may be null until a separately permitted dictionary is imported.
4. **Not all official HSK content is ready-made CSV.** Grammar/topics/tasks/characters should have independently validated parsers and transparent coverage flags. Do not block the entire vocabulary-first MVP waiting for perfectly structured skill data.
5. **Native-style slang is context sensitive.** Slang datasets are not HSK syllabus and may be regionally or temporally limited; do not count “hot” slang as universally appropriate speech.
6. **Free tiers can change and can enforce hard limits.** Provide provider-usage instrumentation and maintain a text-only fallback.
7. **Auth on Worker Static Assets needs care.** Where Cloudflare `ctx.access` is unavailable to Worker logic, explicitly verify Access JWT; do not disable auth for convenience on deploy.
8. **No audio at rest in MVP** is a privacy and cost decision. Add opt-in audio recording only when a specific progress feature demonstrably needs it.
9. **Avoid over-engineering.** One repository, one Worker, one D1 database, one owner. No cron jobs required for daily planning; calculate reminders/reviews upon opening the app.

---

## 16. Cost envelope and infrastructure limits

Target: **$0 infrastructure** within free tiers; text-only AI tutor typically inexpensive for one user's 15–30-minute daily sessions. Actual costs depend on speech minutes, model usage, account tier and region, and are NOT guaranteed to stay at $0–$5.

Useful official sources (check again during deployment):
- Cloudflare Workers/D1 limits: <https://developers.cloudflare.com/workers/platform/limits/> and <https://developers.cloudflare.com/d1/platform/limits/>. D1 Free per-database maximum currently **500 MB** and daily query limits can stop queries at quota.
- Azure Speech F0: <https://azure.microsoft.com/en-us/pricing/details/speech/>. F0 lists **5 hours real-time STT** and **0.5M neural TTS characters** per month; some premium pronunciation features can be billed differently.
- Azure speech locale coverage: <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment>.
- OpenAI model pricing and models: <https://developers.openai.com/api/docs/models> and <https://developers.openai.com/api/docs/pricing>. `gpt-6-luna` is priced per input/output tokens and **does not itself perform speech I/O**.

**Cost controls in code:** maintain rolling UTC-month usage ledger, classify usage at provider boundary, allow a setting to stop paid calls, expose spend estimate with a “provider bill may differ” disclaimer, and fail closed when budget checks cannot be calculated. Use account-level provider quotas/budget alerts where available.

---

## 17. Implementation phases and completion gates for Claude Code

### Phase 0 — Existing-repository inspection and architecture scaffolding
The ShuoLab GitHub repository **already exists** and was created by the owner. Start inside its checked-out working tree. Verify `git rev-parse --show-toplevel`, `git remote -v`, branch, worktree status, and Git identity before changing anything. Review and preserve its tracked files, commits, remote, existing project configuration, and branch protections. **Do not run `gh repo create`, create a second GitHub repository, reinitialize Git (`git init`), replace the `origin` remote, force-push, or overwrite existing repository contents.** If the working directory is not the correct clone or the remote does not match ShuoLab, stop before changing Git state and provide the exact cloning/opening steps to the owner. Only create project files missing from the existing repo, and merge configuration carefully.

Deliver: pnpm/React/Vite/TypeScript/Tailwind/Hono/Workers Static Assets/D1/Drizzle setup, route shells, design tokens, mobile navigation, Zod shared contracts, `.env.example`, docs and automated CI tests. Stub provider adapters only. Establish Cloudflare deployment instructions and Access auth test strategy. Add `.claude/settings.json` with `attribution.commit=""`, `attribution.pr=""`, and `attribution.sessionUrl=false`; ensure `CLAUDE.md` includes the §21 Git/PR policy.

**Gate:** `pnpm install`, typecheck, lint, unit tests, client build and mocked local Worker all succeed on clean clone. No secrets needed for mock mode.

### Phase 1 — Verified HSK import + browsable curriculum
Implement edition/source manifest tables, vocabulary importer, integrity report, verified counts, `curriculum` UI, source/status banners, source attribution, optional slang import. Implement **synthetic fixture** for test/dev, and import instructions for the owner-provided real HSK dataset.

**Gate:** verified 11k-entry real import when dataset supplied; deterministic tests for every count, homograph identity, bad-data rejection; no false official labels in UI.

### Phase 2 — Sessions, adaptive planner and text-only tutor
Implement settings, D1 session/turn tables, simple 15–30 minute planner, text conversation, structured OpenAI adapter, JSON/Zod checks, idempotent turns and server-side usage guard. Include real OpenAI integration behind env configuration plus working mock.

**Gate:** full text-only session works with real imported curriculum; generated invalid IDs cannot enter progress DB. Works with fake provider when no API key is configured.

### Phase 3 — Speech and listen-first experience
Implement Azure short-lived token endpoint, client STT/TTS, recording status, audio controls and transcript-reveal UX, listening activities, fallback typed mode, device/resume flows, no-audio-retention policy.

**Gate:** live Azure manual test pending credentials; automated mocked voice test passes; mobile mic and token refresh checklist available.

### Phase 4 — Review, measurement and release hardening
Implement FSRS review cards/events, evidence-based mastery per skill, HSK and communication dashboards, CSV/JSON exports, account deletion, privacy controls, budget meter, responsive/a11y QA, real mobile testing.

**Gate:** all `P0` FR IDs satisfied, e2e session passes, exported data can round-trip, no secret exposure, Cloudflare Access protection verified, deployment guide accurate.

### Phase 5 — Connected syllabus (owner amendment, 2026-11-26)
Implement §2.5: browse all sections; lesson plans, tutor and session activities using grammar, characters, topics and tasks; grammar and character review cards; speaking and writing review prompts; per-section mastery and progress; band practice tests and the monthly checkpoint.

**Gate:** FR-023 to FR-031 satisfied with tests; a full session runs every step of the §5.3 spine; every place an unverified section is used labels it; verified vocabulary coverage unchanged by section data.

### Phase 6 — P1 enhancements
Pronunciation assessment drill, varied licensed listening voices, deeper analytics, and optional offline recall review.

**Order rule:** Build one complete vertical slice at a time; do not invest in P1 before P0 foundations are functional. At each phase: show what changed, tests executed, known gaps and exact next steps.

---

## 18. Definition of done / handoff package

Claude Code is finished with MVP only when it provides:
- Working source code and a reproducible lockfile, not just design screenshots or pseudocode.
- A `.env.example`, zero committed secrets, a verified auth configuration plan and local mock mode.
- Real D1 migrations, importer and curriculum integrity tests, persisted sessions, mockable provider integrations and secure production API.
- Responsive, accessible installable PWA with complete 15–30 minute daily session flow.
- HSK coverage with traceable source IDs, separate colloquial track and separate communication-progress metrics.
- Automated unit/integration/e2e tests, test instructions, completed FR-001–FR-020 checklist, known provider-dependent manual tests.
- README with one-by-one external account and deployment steps, pricing caveats, export/backup instructions and troubleshooting.
- GitHub publishing checks: Claude Code attribution disabled via `.claude/settings.json`; real owner Git identity used; no assistant co-author trailers or generated PR footers (§21).

**Do not declare “complete”** if voice has never been tested with working credentials, official content has not actually been imported, Access is not verified for the deployed route, or progress reports rely on invented official scores. Report these as explicit incomplete gates instead.

---

## 19. Source and reference register (verified as of 2026-11-10)

1. Official Chinese Test Service HSK portal — <https://www.chinesetest.cn/HSK> (includes *Examination Syllabus*, *Competency Profile*, *Sample Questions*).
2. Official HSK 3.0 global launch announcement — <https://old.chinesetest.cn/gonewcontent.do?flag=kdnew&id=51336883>.
3. 11k HSK 3.0 vocabulary transcription (independent, not official publisher) — <https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset>; see `SOURCES.md` and `LICENSE.md` for edition and rights.
4. Grammar/character/vocabulary companion extraction — <https://github.com/profesorm/hsk30> (inspect rights and source validity before reuse).
5. Colloquial language dataset, 185 entries, CC BY 4.0 — <https://hearmandarin.com/datasets/chinese-slang/>; dataset terms only, NOT examples/audio.
6. Cloudflare Workers Static Assets — <https://developers.cloudflare.com/workers/static-assets/>.
7. Cloudflare Workers Access auth and caveats — <https://developers.cloudflare.com/workers/configuration/cloudflare-access/>.
8. Cloudflare Workers Access protection for all Worker routes (Aug 2026) — <https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/>.
9. Cloudflare D1 limits — <https://developers.cloudflare.com/d1/platform/limits/>.
10. Azure speech pricing/F0 — <https://azure.microsoft.com/en-us/pricing/details/speech/>.
11. Azure pronunciation supported locales/features — <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment> and <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment>.
12. Azure SDK token expiration reference — <https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/troubleshooting>.
13. OpenAI API model catalog/pricing — <https://developers.openai.com/api/docs/models> and <https://developers.openai.com/api/docs/pricing>.

---

## 20. Final instructions to Claude Code

**Implement inside the owner's already-existing ShuoLab repository. Do not create another repository or reinitialize Git.** Start with Phase 0 and proceed in order. Keep the implementation simple and stay within the exact MVP boundaries in this specification. Use safe mocks for Azure/OpenAI when the owner has not yet provided credentials, but make real adapters ready. Treat HSK source files as **external, versioned user-provided data**, and refuse to credit unverified AI-generated material as HSK. Run and report tests after every phase. When an external action is necessary (creating cloud accounts, adding API secrets, activating Access, granting rights to source datasets), give the owner exact steps rather than silently skipping it. Keep the user informed of what is working versus mocked and finish with a runnable application, not just an architecture proposal.

---

## 21. GitHub commit, pull request, and contributor attribution policy (required)

**Owner preference (P0, applies to all generated Git activity):** The owner has already created the personal ShuoLab GitHub repository. Claude Code must work inside the existing clone, not create a new repository. Use the owner's existing, legitimate GitHub account and configured Git identity for commits and pull requests. Do **not** register Claude, Anthropic, an AI model, or an AI bot as a project author, co-author, maintainer, or contributor merely because Claude Code assisted with implementation.

### 21.1 Disable automatically generated Claude Code bylines
In the existing ShuoLab repository, retain or merge the following file at `.claude/settings.json` (preserve any unrelated settings; do not create or reinitialize the repository):

```json
{
  "attribution": {
    "commit": "",
    "pr": "",
    "sessionUrl": false
  }
}
```

These settings suppress Claude Code's own commit-trailer attribution, autogenerated PR footer, and session links, on versions that support these keys. Do not rely only on prompting: use the project settings file and confirm the settings have loaded with `/status` in Claude Code. Do not use the deprecated `includeCoAuthoredBy` flag in new configuration. Official reference: <https://code.claude.com/docs/en/settings-reference#attribution>.

### 21.2 Existing repository protection
- Treat the ShuoLab GitHub repository as **already created**. Do not ask to create it, call `gh repo create`, run `git init` in its worktree, replace `origin`, recreate the default branch, or change the repository name/visibility.
- Check `git status`, `git remote -v`, and branch protection before making Git changes; preserve existing files/history. Do not force-push or delete branches without explicit owner approval.
- For new work, follow the repository's existing branch/PR convention. If there is no convention, propose a small feature branch and request approval for any remote publishing action.

### 21.3 Commit authorship and pull requests
- Use the owner's **already-configured** `git config user.name` and `git config user.email`; if either is unset, ask the owner to configure their real identity **before** committing. Never invent a name/email, impersonate another person, or rewrite another contributor's identity.
- Do not add `Co-Authored-By: Claude ...`, `Co-authored-by: Anthropic ...`, `Generated with Claude Code`, `AI-assisted`, `Claude-Session:`, a Claude Code session URL, or equivalent generated attribution to commit messages or to PR titles, descriptions, templates, changelogs, release notes, and repository badges.
- Do not add Claude/Anthropic to `CONTRIBUTORS`, `AUTHORS`, `package.json` contributors, README acknowledgments, `CODEOWNERS`, repository collaborators, or GitHub team membership. Preserve real human contributor credit and upstream software/license notices.
- Open PRs **using the owner's authenticated GitHub account**, not a separately configured Claude/bot identity. If credentials or permissions are absent, prepare the branch and a clean suggested PR description and ask the owner to open the PR.
- For every PR: summarize product changes, tests, limitations, and source/license implications in normal engineering language; do not append an automatic assistant signature or AI-produced footer. Do not alter repository history solely to conceal past contributors without owner approval.
- Respect any platform-level GitHub labels, organization disclosure rules, or repository compliance requirements. This setting controls what Claude Code writes; it cannot guarantee removal of GitHub's own bot badges or platform-generated metadata.

### 21.4 Pre-commit / pre-PR checks
Before pushing commits or opening a PR:
1. Confirm `git config user.name` and `git config user.email` match the owner's intentional identity. Do not force-modify those values without permission.
2. Review proposed commit messages and PR text for attribution trailers or auto-signatures; omit them before publishing.
3. Inspect `git log -n 10 --format='%h %an <%ae>%n%B'` and relevant repository contributor files for accidental Claude/AI attribution in *new changes*; fix only changes created in the current work and do not rewrite existing published history without permission.
4. When `gh` is available, review the PR body after creation (`gh pr view --json title,body,author`) to ensure the PR description has no autogenerated footer and the PR author is the expected account.
5. If any of the above is unverifiable, disclose that limitation to the owner rather than claiming the checks passed.

**Acceptance criterion:** On the project's newly generated commits and PR descriptions, Claude Code does not insert assistant co-author trailers, generated-by labels, or Claude session links; no assistant account is enrolled as a repository contributor. Legitimate attribution required by law, upstream licenses, or organizational policy is retained.
