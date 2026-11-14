# ShuoLab

An AI-powered Mandarin immersion and learning assistant focused on conversational fluency, personalized practice, and HSK-guided progress tracking.

ShuoLab is a private, single-user progressive web app. It runs in a desktop
browser and installs to an iOS or Android home screen. `SPEC.md` is the source
of truth for what it must do; `docs/PLAN.md` lists the build phases and
`docs/CHECKLIST.md` tracks each requirement.

## Status

Phase 0 (scaffolding) is in place. The app shell, owner authentication, and
the curriculum-status API work locally with no accounts or secrets. Guided
sessions, HSK import, the tutor, speech and review are **not built yet**.

| Area | State |
|---|---|
| App shell, navigation, PWA manifest and service worker | Working, tested locally |
| Owner authentication (Cloudflare Access JWT) | Working against locally signed test tokens; not yet verified on a deployment |
| Curriculum status | Working on local D1; reports "not imported" |
| HSK vocabulary import | Phase 1 |
| Sessions and tutor | Phase 2 — only a local fake tutor exists |
| Speech | Phase 3 — only a local fake token issuer exists |
| Review, progress, export | Phase 4 |

Nothing has been deployed, and no real OpenAI or Azure call has been made.

## Requirements

- Node.js 24 or newer
- pnpm 12 (`npm install -g pnpm`)

## Run it locally

```bash
pnpm install
pnpm dev
```

`pnpm dev` creates `.dev.vars` from `.env.example` on first run, applies the
database migrations to a local D1 database under `.wrangler/`, and starts the
client and the Worker together. Open the address it prints.

Local mode skips sign-in on `localhost` only and uses fake providers. It needs
no secrets and costs nothing.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Client + API + local D1 in one process |
| `pnpm typecheck` | TypeScript for client, Worker, scripts and tests |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit and integration tests (Vitest; real local D1 engine via Wrangler) |
| `pnpm test:e2e` | Browser tests (Playwright) against the production build |
| `pnpm build` | Production build into `dist/` |
| `pnpm verify` | typecheck, lint, test and build in one go |
| `pnpm db:generate` | Generate a SQL migration after editing `src/server/db/schema.ts` |
| `pnpm db:migrate:local` | Apply migrations to the local database |
| `pnpm db:migrate:remote` | Apply migrations to the deployed database |
| `pnpm deploy` | Safety checks, build, then `wrangler deploy` |
| `pnpm icons` | Regenerate the app icons |

Before the first `pnpm test:e2e`, install the test browser once:

```bash
pnpm exec playwright install chromium
```

Not available yet: `pnpm curriculum:import` and `pnpm curriculum:verify`
(Phase 1).

## Layout

```text
src/
  client/        React app: app/ (routes, layout), pages/, components/, hooks/, lib/, styles/
  server/        Hono Worker: index.ts, auth/, routes via services/, providers/, db/, validation/
  shared/        Zod API contracts and curriculum constants used by both sides
scripts/         Dev and deploy helpers
test/
  unit/          Pure logic
  integration/   API against a real local D1
  client/        Component tests (Testing Library)
  e2e/           Playwright
  helpers/       Local D1 and locally signed Access tokens
public/          Manifest, icons, security headers
docs/            Plan, checklist, decisions, architecture, data sources, privacy, costs
private-data/    Your HSK source files — git-ignored, never committed
```

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `APP_ENV` | `wrangler.jsonc` (`production`); `.dev.vars` (`development`) | Anything other than `development` or `test` is treated as production |
| `DEV_AUTH_BYPASS` | `.dev.vars` only | Skips sign-in on localhost. The Worker refuses all requests if this is set in production |
| `OWNER_EMAIL` | secret | The one email allowed in |
| `ACCESS_TEAM_DOMAIN` | secret | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | secret | Audience tag of the Access application |
| `OPENAI_API_KEY` | secret | Tutor (Phase 2). Paid third-party account |
| `OPENAI_MODEL` | `wrangler.jsonc` | Defaults to `gpt-6-luna` |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | secret | Speech (Phase 3). Third-party account; free tier available |

Never put a secret in `wrangler.jsonc`, in a `VITE_*` variable, or in a commit.

## Deploying

These steps have not been exercised yet; they will be verified, and corrected
if needed, in Phase 4. You need a Cloudflare account. Nothing here is required
for local development.

### 1. Cloudflare and D1

```bash
pnpm exec wrangler login
```

```bash
pnpm exec wrangler d1 create shuolab
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing the
placeholder of zeros. Then create the tables:

```bash
pnpm db:migrate:remote
```

### 2. First deploy

```bash
pnpm deploy
```

`pnpm deploy` stops if `wrangler.jsonc` still has the placeholder database id,
contains `DEV_AUTH_BYPASS` or a plain-text key, or has preview URLs enabled.
Until step 3 is done the API answers every request with "Cloudflare Access is
not configured", so no data is exposed in between.

### 3. Cloudflare Access

1. In the Cloudflare dashboard open **Workers & Pages → shuolab → Settings →
   Domains & Routes**.
2. On the `workers.dev` row choose **Enable Cloudflare Access**. This creates
   an Access application for the hostname. If you add a custom domain later,
   protect it the same way.
3. Open **Manage Cloudflare Access** and edit the policy so the only rule is
   **Include → Emails → your email address**.
4. Note the two values shown for the application: the **Application Audience
   (AUD) tag** and your **team domain** (`https://<team>.cloudflareaccess.com`).
5. Store them, with your email, as secrets:

```bash
pnpm exec wrangler secret put OWNER_EMAIL
```

```bash
pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN
```

```bash
pnpm exec wrangler secret put ACCESS_AUD
```

Reference: <https://developers.cloudflare.com/workers/configuration/cloudflare-access/>

### 4. Verify Access

- In a private browser window, the site must show the Access sign-in page.
- This must not return your data (expect a redirect or an error):

```bash
curl -i https://<your-hostname>/api/v1/me
```

- After signing in, **Settings** must show "Signed in as" your email.

### 5. Provider keys (when the features exist)

OpenAI (Phase 2): create an API key at <https://platform.openai.com/>, set a
monthly budget limit in the OpenAI console, then:

```bash
pnpm exec wrangler secret put OPENAI_API_KEY
```

Azure Speech (Phase 3): in the Azure portal create a **Speech** resource on
the **F0 (free)** tier, note its key and region, then:

```bash
pnpm exec wrangler secret put AZURE_SPEECH_KEY
```

```bash
pnpm exec wrangler secret put AZURE_SPEECH_REGION
```

For local testing with real providers, add the same names to `.dev.vars`.

## Installing on a phone

After deployment and sign-in:

- **iOS (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app (or Add to Home screen).

Installation has not been tested on a real device yet.

## HSK data

ShuoLab never invents HSK words or levels. You import the November 2025 HSK
3.0 vocabulary (11,000 numbered entries) from your own copy into
`private-data/`, which is git-ignored. The import tool and exact file format
arrive in Phase 1; see `docs/DATA_SOURCES.md`. Until then the app says
"Curriculum not imported".

## Budget limits, backup and export

Not built yet. Spending limits arrive with the tutor (Phase 2) and JSON/CSV
export with Phase 4. See `docs/COSTS.md` and `docs/PRIVACY.md`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Every API call returns "This deployment is misconfigured" | `DEV_AUTH_BYPASS` is set outside local development. Remove it. |
| "Cloudflare Access is not configured" | Set `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (Deploying, step 3). |
| "This account is not the owner" | You signed in with a different email than `OWNER_EMAIL`. |
| "Your sign-in may have expired" | The Access session ended. Reload the page. |
| `pnpm dev` says a table is missing | Run `pnpm db:migrate:local`. |
| `pnpm install` reports ignored build scripts | `pnpm-workspace.yaml` must allow `esbuild` and `workerd`; it does in this repository. |
