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
| `GET /api/v1/sessions/:id` | owner | one session with its saved plan |
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
(which curriculum entries a session targets, and in what role).

Session planning is plain code with no model call. `src/server/services/planner.ts`
is pure: given candidates it returns a plan. `src/server/services/sessions.ts`
reads the candidates from D1, checks every target id and band against
`curriculum_items` before saving, and writes the session and its targets in
one batch. The plan contract is `src/shared/session.ts`.

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
