# Privacy

ShuoLab is for one person. It has no analytics, advertising, social features
or third-party tracking scripts.

## What is stored today (Phase 0)

Nothing about the learner. The database holds only curriculum reference
tables, and they are empty until the owner imports data.

## What later phases will store

| Data | Where | Kept until |
|---|---|---|
| Settings | D1 | changed or deleted by the owner |
| Session plans, typed and transcribed turns, tutor replies | D1 | deleted by the owner, or the retention period in Settings |
| Practice attempts, review history, mastery | D1 | deleted by the owner |
| Usage ledger (token and character counts, estimated cost) | D1 | deleted by the owner |
| Raw audio | **never stored** | — |

## Who receives what

| Processor | Receives | When |
|---|---|---|
| Cloudflare | All requests; the D1 database | Always |
| OpenAI | Text of the conversation and a short list of target words | Phase 2 onward, only if a key is configured |
| Azure AI Speech | Microphone audio for transcription; reply text for speech | Phase 3 onward, only if a key is configured |

No transcript is sent to any other vendor. Payment details, contacts and
location are never collected.

## Secrets

Provider keys exist only as Worker secrets. They are never sent to the
browser, logged, or written to the database. The speech endpoint will return a
short-lived token, not the key.
