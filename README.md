# ShuoLab

An AI-powered Mandarin immersion and learning assistant focused on conversational fluency, personalized practice, and HSK-guided progress tracking.

ShuoLab is a private, single-user progressive web app. It runs in a desktop
browser and installs to an iOS or Android home screen. `SPEC.md` is the source
of truth for what it must do; `docs/PLAN.md` lists the build phases and
`docs/CHECKLIST.md` tracks each requirement.

## Status

Phase 0 (scaffolding) and Phase 1 (the vocabulary importer, curriculum
browsing and the separate colloquial track) are in place. The app shell, owner
authentication, the import tools and browsing, searching and opening imported
entries work locally with no accounts or secrets. Phase 2 has started: your
preferences (onboarding and Settings) are saved in the database, and Today
plans a session: a situation, the words to practise and a time budget. You
can then run the session as a typed conversation: send messages, pause and
resume, reload without losing anything, and finish to a summary. Without a
key the replies come from a stand-in tutor that returns prepared sentences;
with `OPENAI_API_KEY` in `.dev.vars` the real tutor answers. One live open
conversation has been run locally (2026-11-15). You can also speak your
replies and hear the tutor's (Azure AI Speech, free tier); without Azure
settings a stand-in pretends to hear a fixed sentence and plays nothing.
**Real speech has not been tried yet**: it needs your Azure key and a phone.
Review and progress are **not built yet**.

| Area | State |
|---|---|
| App shell, navigation, PWA manifest and service worker | Working, tested locally |
| Owner authentication (Cloudflare Access JWT) | Working against locally signed test tokens; not yet verified on a deployment |
| Curriculum status | Working on local D1 |
| HSK vocabulary import | Working and tested with generated placeholder data; not yet run on the real dataset |
| Browsing entries | Working and tested with generated placeholder data |
| Colloquial expressions (separate from HSK) | Working and tested with generated placeholder rows; not yet run on the real dataset file |
| Preferences (onboarding, Settings) | Working locally; saved in the database, so they follow you across devices once deployed |
| Session planning | Working locally and tested with generated placeholder data: one saved plan per study day for 15, 20, 25 or 30 minutes, or a labelled open conversation when no vocabulary is imported |
| Tutor turns (API) | Working locally with the stand-in tutor: validated replies, each message saved once, spending recorded and capped. One live open conversation with `gpt-6-luna` run locally: Mandarin replies, a correction, an injection attempt declined, pinyin and English returned, usage recorded |
| Session conversation screen | Working locally with the stand-in tutor: typed turns, pause, resume, finish, summary, recovery after a reload or a dropped connection. Typed only; listening and speaking arrive in Phase 3 |
| Speech tokens and free-tier count | Working locally with a stand-in token issuer: `POST /speech/token`, usage reports, the Azure F0 allowance enforced and shown in Settings. The Azure issuer is written and unit-tested; **no real Azure call has been made** |
| Speaking and listening in a session | Working locally with the stand-in: Speak, read replies aloud, Play, listen first with recorded reveals, unsure transcripts checked before sending, typed fallback for every failure. Real Azure recognition and voice tried by the owner on a computer (2026-11-25); **not yet on a phone** |
| Separate listen-first exercise | Working locally: a short exchange written by the tutor for the session's situation and words, played before any text, with 2–3 questions scored before the text is shown. Tried once with the real OpenAI tutor; Azure playback of the exchange **not yet heard by the owner** |
| Review, progress, export | Phase 4 |

Nothing has been deployed. OpenAI has been called only from a local run; no Azure call has been made.

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
| `pnpm curriculum:import` | Validate and import your HSK vocabulary files (see below) |
| `pnpm curriculum:verify` | Check the stored curriculum against the edition's published totals |
| `pnpm colloquial:import` | Validate and import the optional colloquial-expression dataset (see below) |
| `pnpm seed:dev` | Load generated placeholder vocabulary and colloquial rows into the local database |
| `pnpm deploy` | Safety checks, build, then `wrangler deploy` |
| `pnpm icons` | Regenerate the app icons |

Before the first `pnpm test:e2e`, install the test browser once:

```bash
pnpm exec playwright install chromium
```

The browser tests build the app once and use two databases of their own: an
empty one (`.wrangler/e2e-state`) and one loaded with generated placeholder
entries (`.wrangler/e2e-seeded`), each served on its own port (4173, 4174).
They are unaffected by anything imported into the development database.

To try browsing locally without the real dataset, run `pnpm seed:dev`. It
loads generated placeholder entries, which the app labels as test data, not
HSK content, on every page where they appear.

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
| `AZURE_SPEECH_KEY` | secret | Speech (Phase 3). Third-party account; free tier available |
| `AZURE_SPEECH_REGION` | secret or `wrangler.jsonc` | The resource's region name, such as `eastus` |
| `AZURE_RECOGNITION_SECONDS_PER_MONTH`, `AZURE_SYNTHESIS_CHARS_PER_MONTH` | `wrangler.jsonc` or `.dev.vars` (optional) | Lower speech limits than the free allowance (18,000 seconds and 500,000 characters). Higher values are ignored |

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

Azure Speech (Phase 3):

1. Sign in at <https://portal.azure.com/>. A free Azure account needs a card
   for identity checks; the F0 tier itself is not billed.
2. Create a resource of type **Speech** (under Azure AI services). Choose a
   region close to you, for example `eastasia` or `westus2`, and the
   **Free F0** pricing tier. Only one F0 Speech resource is allowed per
   subscription.
3. Open the resource's **Keys and Endpoint** page and note **KEY 1** and the
   **Location/Region** (a plain name such as `eastasia`).
4. Do not upgrade the resource to S0. ShuoLab stops speech at the F0
   allowance (5 hours of recognition and 500,000 voice characters a month)
   and falls back to typing; it never moves to a paid tier.

Then:

```bash
pnpm exec wrangler secret put AZURE_SPEECH_KEY
```

```bash
pnpm exec wrangler secret put AZURE_SPEECH_REGION
```

For local testing with real providers, add the same names to `.dev.vars`,
one per line as `NAME=value`, without a leading `#`. The browser tests never
use them: they replace the build's copy of `.dev.vars` with stand-in values.

## Installing on a phone

After deployment and sign-in:

- **iOS (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app (or Add to Home screen).

Installation has not been tested on a real device yet.

## Importing the HSK vocabulary

ShuoLab never invents HSK words or levels. You import the November 2025 HSK
3.0 vocabulary (11,000 numbered entries) from your own copy. The files stay in
`private-data/`, which is git-ignored, and are never committed or bundled into
the app. Until the import passes, the app says "Curriculum not imported".

The importer has been tested with generated placeholder data only. **It has
not yet been run on the real dataset**; the first real run is the check that
the field mapping below matches every row.

### 1. Get the files

The source is an independent transcription of the syllabus:
<https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset>. Read its
`LICENSE.md` and `SOURCES.md` first: it states no licence for the vocabulary
data itself, so this is a local, personal import, not something to republish.

Clone it somewhere outside this repository and note the commit:

```bash
git clone https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset.git
```

```bash
git -C hsk-3.0-vocabulary-dataset rev-parse HEAD
```

### 2. Copy one set of files

Copy the seven per-level CSV files from the dataset's `data/by-level/` folder
(`hsk-1.csv` … `hsk-6.csv`, `hsk-7-9.csv`) into `private-data/hsk-vocab/`.

Use one set only. The single complete file (`data/hsk-3.0-all.csv`) also
works on its own, as do the JSON versions. Do not mix sets or formats, and do
not use `data/cumulative/`: every numbered entry must appear exactly once, and
the import is rejected otherwise.

### 3. Check, then import

Validate without writing anything:

```bash
pnpm curriculum:import --source ./private-data/hsk-vocab --edition hsk3-2025-11 --commit <the 40-character commit from step 1> --dry-run
```

Import into the local database (stop `pnpm dev` first):

```bash
pnpm curriculum:import --source ./private-data/hsk-vocab --edition hsk3-2025-11 --commit <the 40-character commit from step 1>
```

Check what is stored at any time:

```bash
pnpm curriculum:verify
```

Add `--remote` to either command to target the deployed database. The remote
path has not been exercised yet.

### What the import checks

Everything is validated before anything is written, and the write is a single
transaction, so a rejected or failed import leaves the database untouched.

- Files are valid UTF-8 (a BOM is fine) and well-formed CSV or JSON.
- Columns: `id`, `level`, `hanzi`, `pinyin`, `part_of_speech`, `entry`,
  `homograph`, `level_label`, `source_pdf_page`. Only `part_of_speech` and
  `homograph` may be empty.
- `id` is a whole number, unique, and covers 1–11,000 with no gaps.
- `level` is `1`–`6` or `7-9`. Separate 7, 8 or 9 levels are rejected.
- Each band holds exactly the published number of new entries
  (300, 200, 500, 1,000, 1,600, 1,800, 5,600).
- Entries that share a written form stay separate items, told apart by
  `entry` and `homograph`.

Each file's SHA-256, the source URL, the pinned commit, a rights note and the
field-mapping version (`vocab-v1`) are stored and shown on the Curriculum page.
Re-running the same import changes nothing. English definitions are not
imported; the syllabus has none.

Grammar, characters, topics and tasks have no importer yet and show as
"Not imported".

### Placeholder data for development

```bash
pnpm seed:dev
```

loads 11,000 generated placeholder entries (`样例词1` …) into the local
database under a separate `synthetic-fixture` edition. The app labels them
"Test data loaded, not HSK content". This command never touches the deployed
database, and it refuses to replace a real edition unless you pass `--force`.
It also loads 12 placeholder colloquial rows, labelled "Test data, not real
expressions".

## Importing colloquial expressions (optional)

Everyday and slang expressions are a separate track. They have no HSK level
and are never part of an HSK count. The source is the HearMandarin dataset
(185 expressions, CC BY 4.0, credit "HearMandarin (https://hearmandarin.com)").

1. Open <https://hearmandarin.com/datasets/chinese-slang/> and download the
   JSON file (`chinese-slang.json`). The CSV works too.
2. Save it as `private-data/colloquial/chinese-slang.json` (that folder is
   git-ignored).
3. Check it, then import it:

```bash
pnpm colloquial:import --file ./private-data/colloquial/chinese-slang.json --dry-run
```

```bash
pnpm colloquial:import --file ./private-data/colloquial/chinese-slang.json
```

Add `--remote` to import into the deployed database (not yet exercised).
For the CSV, pass the version shown on the dataset page with
`--dataset-version`.

The import rejects the whole file if any row has a duplicate or invalid
identifier, an unknown register, channel or status, a malformed date, a
non-https entry address, a missing term or meaning, or damaged text. The
source's register words are stored as: `anyone` → fine with anyone,
`casual` → casual, `mates` → very informal. A status with no "checked" date
is stored as "not verified". Example sentences and audio are not part of the
dataset's licence and are never imported; each expression links to its entry
on the source's site instead.

The page is at `/curriculum/colloquial`.

## Budget limits, backup and export

The monthly warning and stop amounts can be set in Settings (defaults US$5
and US$10). They are enforced for the tutor: every tutor call is
recorded with its token counts and an estimated cost, and once the month's
estimate (UTC month) reaches the stop amount, paid tutor requests are refused
until the month ends or you raise the amount. Settings shows the month's
estimate. It is ShuoLab's own estimate from list prices, not a cap at OpenAI
or Azure and not your bill, so set limits in those accounts too. The built-in
price is for the default model `gpt-6-luna` (US$0.10 per million input tokens
and US$0.50 per million output tokens, read from OpenAI's pricing page on
2026-11-14). If you change `OPENAI_MODEL` or prices change, set
`OPENAI_INPUT_USD_PER_MTOK` and `OPENAI_OUTPUT_USD_PER_MTOK`; a model with no
known price is refused rather than run untracked. JSON/CSV export arrives with
Phase 4. See `docs/COSTS.md` and `docs/PRIVACY.md`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Every API call returns "This deployment is misconfigured" | `DEV_AUTH_BYPASS` is set outside local development. Remove it. |
| "Cloudflare Access is not configured" | Set `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (Deploying, step 3). |
| "This account is not the owner" | You signed in with a different email than `OWNER_EMAIL`. |
| "Your sign-in may have expired" | The Access session ended. Reload the page. |
| `pnpm dev` says a table is missing | Run `pnpm db:migrate:local`. |
| `pnpm install` reports ignored build scripts | `pnpm-workspace.yaml` must allow `esbuild` and `workerd`; it does in this repository. |
