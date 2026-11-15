# Privacy

ShuoLab is for one person. It has no analytics, advertising, social features
or third-party tracking scripts.

## What is stored today

- Settings, session plans, and for each turn: the text you typed, the tutor's
  validated reply, and which of the session's words it used.
- A usage ledger: provider, model, token counts, estimated cost and status
  per tutor call. It holds no message text.

- In your browser only (`localStorage`): the text you are typing in a
  session and a message that was sent but not yet confirmed. It is removed
  once the server has the message, and it is never sent anywhere else.

Deleting a session deletes its turns. Deletion and export from the app
arrive in Phase 4. Nothing is logged: the Worker logs only the name of an
unexpected error, never a prompt, a reply, a provider response or a key.

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
| OpenAI | The instructions (situation, the session's target words), up to eight earlier turns and your new message. Sent with `store: false`. | On each tutor turn, only if a key is configured |
| Azure AI Speech | Microphone audio for transcription and the tutor's reply text for its voice, sent from your browser directly to Azure with a short-lived token. ShuoLab receives only the transcript, and the length and character counts it records for the free-tier limit | Phase 3 onward, only if a key is configured |

No transcript is sent to any other vendor. Payment details, contacts and
location are never collected.

## Secrets

Provider keys exist only as Worker secrets. They are never sent to the
browser, logged, or written to the database. The speech endpoint will return a
short-lived token, not the key.
