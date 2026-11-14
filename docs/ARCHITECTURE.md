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

## What exists today (Phase 0)

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/v1/health` | public | `{ready, version}` only |
| `GET /api/v1/me` | owner | sign-in mode, provider state, whether vocabulary is verified |
| `GET /api/v1/curriculum/status` | owner | per-section import state, per-band counts, source manifests |

Tables: `curriculum_editions`, `source_manifests`, `curriculum_items`.

Provider adapters are interfaces plus local fakes (`src/server/providers`).
No request leaves the Worker yet.

## Access auth test strategy

- Automated: tests sign JWTs with a locally generated RSA key and inject the
  matching key set, so the real verification code runs with no network
  (`test/helpers/access.ts`).
- Manual, after deployment: the checklist in the README's "Verify Access"
  section — unauthenticated `curl` to `/api/v1/me` must not return data, and a
  private-window visit must show the Access sign-in page.
