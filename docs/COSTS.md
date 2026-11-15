# Costs

Target: no infrastructure cost within free tiers, and a small, capped provider
spend. None of this is guaranteed; provider prices and free allowances change.
Check the linked pages before going live.

## Today

Local development and tests use the stand-in tutor: no paid calls. The tutor
route calls OpenAI only when `OPENAI_API_KEY` is set as a Worker secret. No
real OpenAI call has been made yet, so the figures below are estimates from
list prices, not measurements.

## What a tutor turn costs (estimate)

The default model is `gpt-6-luna`: US$0.10 per million input tokens and
US$0.50 per million output tokens (standard tier, read from the pricing page
on 2026-11-14). A turn sends the instructions, up to eight earlier turns and
the new message, and gets back a short JSON reply. At roughly 1,000 input and
150 output tokens that is about US$0.0002 a turn; a retry after a rejected
answer doubles it. Check the first real session's figures in Settings against
the OpenAI usage page.

## Free-tier limits to know

| Service | Limit | Source |
|---|---|---|
| Cloudflare D1 Free | 500 MB per database; daily query quotas that stop queries when reached | <https://developers.cloudflare.com/d1/platform/limits/> |
| Cloudflare Workers Free | daily request quota | <https://developers.cloudflare.com/workers/platform/limits/> |
| Azure Speech F0 | 5 audio hours of transcription and 500,000 neural TTS characters per month, as documented; verify in the Azure portal | <https://azure.microsoft.com/en-us/pricing/details/speech/> |
| OpenAI | billed per input and output token | <https://developers.openai.com/api/docs/pricing> |

## Controls built in

- No background polling: the client fetches on navigation and on request only.
- No audio storage.
- No scheduled jobs.
- Every tutor call is written to `usage_events` with its token counts, an
  estimated cost and whether the answer was used, rejected or failed.
- Warning at US$5 and stop at US$10 of estimated spending per UTC month, both
  editable in Settings. At the stop amount paid tutor requests get
  `429 BUDGET_EXCEEDED`. Already-saved turns can still be read.
- The gate fails closed: if the month's total cannot be read, or the model has
  no known price, the paid call is refused.
- Cached input tokens are counted at the full input price, so the estimate
  errs high.
- At most 20 tutor calls a minute, 600 a day and 80 turns a session; replies
  are capped at 900 output tokens.
- A failed call (timeout, network) is logged with zero tokens because the
  provider reported none; it may still have been billed.

## Controls arriving with the features that spend money

- Phase 3: speech token rate limit; separate tracking of Azure free-tier
  minutes and characters; no automatic move to a paid tier.

The in-app figure is an estimate. Also set budget alerts or hard limits in the
OpenAI and Azure consoles.
