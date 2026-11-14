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

Client pages: `/curriculum` (overview), `/curriculum/:band` (entries of one
band; filters live in the address as `?q=` and `?pos=`),
`/curriculum/item/:itemId` (one entry).

Tables: `curriculum_editions`, `source_manifests`, `curriculum_items`.

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
