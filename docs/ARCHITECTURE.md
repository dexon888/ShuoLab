# Architecture

One repository, one Cloudflare Worker, one D1 database, one owner.

```text
Browser / installed PWA  (src/client — React, React Router, TanStack Query)
        |  same-origin HTTPS, /api/v1/*
        v
Cloudflare Worker        (src/server — Hono)
   configGuard  -> refuses everything if the deployment is misconfigured
   /health      -> public, status only
   requireOwner -> verifies the Cloudflare Access JWT, checks the owner email
   routes       -> services -> D1 (Drizzle)
   providers    -> OpenAI (text), Azure Speech token issuer; fakes for local use
        |
        v
Cloudflare D1            (src/server/db — schema.ts + SQL migrations)
```

`src/shared` holds the Zod API contracts and curriculum constants used by both
sides. The client validates every response against the same schema the server
produced it from.

## Request path

1. Static files are served by Workers Static Assets with the headers in
   `public/_headers`. Unknown paths fall back to `index.html`.
2. `/api/*` always reaches the Worker first (`run_worker_first`).
3. Errors use one envelope: `{"error": {"code", "message", "retryable"}}`.
   Messages are written in the Worker and never include provider output,
   tokens or prompts.

## What exists today

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/health` | public | `{ready, version}` only |
| `GET /api/v1/me` | owner | sign-in mode, provider state, whether vocabulary is verified |
| `GET /api/v1/curriculum/status` | owner | per-section import state, per-band counts, source manifests |
| `GET /api/v1/curriculum/items` | owner | one page (default 50, max 100) of the active edition's entries; filters `band`, `type`, `pos`, `q`, `state`; opaque `cursor`; `total` for the filters |
| `GET /api/v1/curriculum/facets` | owner | part-of-speech tags present in a band, with counts |
| `GET /api/v1/curriculum/items/:id` | owner | one entry with its edition, source manifests and same-form entries |
| `GET /api/v1/settings` | owner | saved preferences, or the defaults when nothing is saved (also included in `/me`) |
| `PUT /api/v1/settings` | owner | partial update of whitelisted preference fields; unknown fields are rejected; returns the full settings |
| `POST /api/v1/sessions/plan` | owner | plans today's session from the saved settings (optional `durationMinutes`, `studyBand`, `freeChat`); 201 for a new plan, 200 with `reused: true` when today's unfinished session is returned; 503 `CURRICULUM_MISSING` for an HSK plan with no verified vocabulary |
| `GET /api/v1/sessions/:id` | owner | one session with its saved plan, its finished turns oldest first and, once complete, its summary |
| `PATCH /api/v1/sessions/:id` | owner | `{action: "pause" \| "resume" \| "abandon"}`; repeating an action is a no-op; 409 when the session has not started or has ended |
| `POST /api/v1/sessions/:id/complete` | owner | finishes the session and returns its summary; repeating it returns the same summary; 409 with no turns or after abandon |
| `POST /api/v1/sessions/:id/turn` | owner | `{clientTurnId, transcript, sourceMode, asrUncertain}`; 201 with the tutor's validated reply, 200 with `replayed: true` when that `clientTurnId` was already answered; 409 while the same message is still being answered or when the session has ended; 429 `BUDGET_EXCEEDED` or `RATE_LIMITED`; 503 when the tutor is unreachable or not set up |
| `GET /api/v1/usage/monthly` | owner | this UTC month's estimated spending, the warning and stop amounts, tutor request and token counts, this month's speech use against the free allowance, and a disclaimer |
| `POST /api/v1/speech/token` | owner | a short-lived Azure token, the region, when to refresh (nine minutes), whether it is the stand-in, and the month's speech allowance; 429 `BUDGET_EXCEEDED` once both recognition and voice allowances are used up; 429 `RATE_LIMITED` over 6 a minute or 300 a day; 503 when speech is not set up |
| `POST /api/v1/speech/usage` | owner | `{clientEventId, kind: "recognition", audioSeconds}` (at most 60) or `{clientEventId, kind: "synthesis", characters}` (at most 2,000); 201 when counted, 200 when that event was already counted |
| `GET /api/v1/sessions` | owner | the most recent sessions (`limit` 1–50, default 10) and today's resumable one, if any |
| `GET /api/v1/colloquial` | owner | one page of colloquial expressions with `register`, `channel`, `status`, `q` filters, plus the sources to credit; reads only `colloquial_expressions` |

Client pages: `/curriculum` (overview), `/curriculum/:band` (entries of one
band; filters live in the address as `?q=` and `?pos=`),
`/curriculum/item/:itemId` (one entry), `/curriculum/colloquial` (the
separate colloquial track), `/onboarding` and `/settings` (the same
preferences form; Settings adds the spending limits), `/` (Today: start
or reopen today's session) and `/session/:sessionId` (the saved plan).

Tables: `curriculum_editions`, `source_manifests`, `curriculum_items`,
`colloquial_expressions`, `owner_settings` (at most one row), `sessions`
(the plan is stored as validated JSON in `plan_json`) and `session_targets`
(which curriculum entries a session targets, and in what role),
`conversation_turns` and `usage_events`.

Session planning is plain code with no model call. `src/server/services/planner.ts`
is pure: given candidates it returns a plan. `src/server/services/sessions.ts`
reads the candidates from D1, checks every target id and band against
`curriculum_items` before saving, and writes the session and its targets in
one batch. The plan contract is `src/shared/session.ts`.

## Tutor turns

`conversation_turns` holds one row per learner message and its answer;
`usage_events` holds one row per provider call. The order of work in
`src/server/services/turns.ts`:

1. Load the session; refuse if it has ended.
2. If this `clientTurnId` is already answered, return the saved turn.
3. Check the per-session turn cap, the request rate and the month's budget.
4. Reserve the turn row as `pending` (the unique index makes this the lock).
5. Build the instructions from the saved plan and from `session_targets`
   joined to `curriculum_items`. Learner text is sent only as conversation
   messages, never inside the instructions.
6. Call the provider, at most twice. Each call is written to `usage_events`.
   The answer must be JSON matching `tutorOutputSchema` (`src/shared/tutor.ts`)
   with a Mandarin reply; a rejected answer is retried once with the reason.
7. Keep a referenced id only if it is one of this session's targets and its
   word is in the reply. After two rejected answers, use a prepared reply
   with no feedback.
8. In one batch, mark the turn `complete` and the session `active`.

A provider failure marks the row `failed`; the same `clientTurnId` can then
be sent again. Providers implement `TutorProvider`
(`src/server/providers/types.ts`): `OpenAiTutorProvider` calls the Responses
API with a strict JSON schema, `store: false` and a 20-second timeout;
`FakeTutorProvider` is the local stand-in. `selectTutorProvider` picks one per
request from the Worker environment; tests inject one through `createApp`.

## Speech tokens and the free-tier count

The browser will talk to Azure AI Speech directly with a token from
`POST /speech/token` (`src/server/services/speech.ts`). The Worker exchanges
`AZURE_SPEECH_KEY` for a 10-minute token at
`https://<region>.api.cognitive.microsoft.com/sts/v1.0/issueToken`
(`src/server/providers/azure.ts`) and tells the browser to refresh after nine.
The key never leaves the Worker; the token is never stored or logged.

Audio never reaches ShuoLab, so the browser reports each recognition's length
and each spoken reply's character count to `POST /speech/usage`. Reports are
stored in `usage_events` with a unique `client_event_id`, so a resent report
counts once. The month's totals are compared with the Azure F0 allowance
(lowerable by configuration, never raisable). Speech on F0 costs nothing, so
it adds nothing to the spending estimate.

## Session state, practice time and the summary

`src/server/services/session-state.ts`. A session moves
`planned → active ⇄ paused → complete`, or to `abandoned` from any unfinished
state. The first turn makes it `active`; a paused session refuses turns until
resumed. Each transition is one `UPDATE ... WHERE status IN (...)`.

Practice time (`sessions.actual_seconds`) is counted on the server: each turn,
pause and completion adds the time since `last_activity_at`, capped at 180
seconds, and resume restarts the clock. The client never reports a duration.

The summary is computed from the saved turns each time it is read
(`buildDebrief`): turn counts by typed and spoken, which planned words the
learner wrote and which only the tutor used, up to three recent corrections,
and the planned words the learner did not use. It writes nothing to mastery.

On the client, `src/client/components/Conversation.tsx` makes one
`clientTurnId` per message and reuses it on every retry. The text being typed
and a sent-but-unconfirmed message are kept in `localStorage`
(`src/client/lib/draft.ts`) and removed once the server has the message.

Writes: a JSON body of at most 16 KB, validated by a strict Zod schema shared
with the client. A write whose `Origin` header names another host is refused
(`src/server/validation/body.ts`).

## Curriculum import

`src/server/services/curriculum-import` is pure code with no file or network
access: read files → validate against the edition's published totals → build
SQL statements. The scripts in `scripts/` supply the files and the database.

```text
files ─ readVocabFiles ─ validateVocab ─ buildImportStatements ─ one D1 batch (transaction)
                              │ any issue
                              └──────────► report, exit 1, nothing written
```

- Local imports use Wrangler's D1 binding and one `batch`, which is atomic.
- `--remote` renders the same statements as a SQL script for
  `wrangler d1 execute --remote --file`. The script is tested against local
  D1; the remote run itself is untested.
- `verifyDatabase` re-checks what is stored, independently of the import.

Provider adapters are interfaces plus local fakes (`src/server/providers`).
No request leaves the Worker yet.

## Access auth test strategy

- Automated: tests sign JWTs with a locally generated RSA key and inject the
  matching key set, so the real verification code runs with no network
  (`test/helpers/access.ts`).
- Manual, after deployment: the checklist in the README's "Verify Access"
  section — unauthenticated `curl` to `/api/v1/me` must not return data, and a
  private-window visit must show the Access sign-in page.
