# Costs

Target: no infrastructure cost within free tiers, and a small, capped provider
spend. None of this is guaranteed; provider prices and free allowances change.
Check the linked pages before going live.

## Today

Local development and tests use the stand-in tutor: no paid calls. The tutor
route calls OpenAI only when `OPENAI_API_KEY` is set (in `.dev.vars` locally,
as a Worker secret when deployed).

## What a tutor turn costs (estimate)

The default model is `gpt-6-luna`: US$0.10 per million input tokens and
US$0.50 per million output tokens (standard tier, read from the pricing page
on 2026-11-14). A turn sends the instructions, up to eight earlier turns and
the new message, and gets back a short JSON reply with pinyin and an English
translation. A retry after a rejected answer doubles a turn's cost.

Measured on the first live run (2026-11-15, open conversation, 5 turns):
3,199 input and 1,171 output tokens, US$0.0009 by ShuoLab's estimate, about
US$0.0002 a turn. Turns grow as the conversation does, since up to eight
earlier turns are resent. Compare Settings with the OpenAI usage page once
OpenAI's own figures have caught up.

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

## Speech (Azure F0)

- Speech runs on Azure's free F0 tier: 5 hours of real-time recognition and
  500,000 neural voice characters a month (Azure pricing page, read
  2026-11-15). F0 also allows only one recognition at a time.
- ShuoLab counts what the browser reports after each recognition and each
  spoken reply, per UTC month. Azure's own month may not line up with UTC.
- With recognition used up, the token still comes with `recognitionAvailable:
  false` and the session falls back to typing; with voice used up, replies are
  shown as text. With both used up, no token is issued.
- `AZURE_RECOGNITION_SECONDS_PER_MONTH` and `AZURE_SYNTHESIS_CHARS_PER_MONTH`
  can lower the limits, for example to keep a margin; higher values are
  ignored.
- At most 6 speech tokens a minute and 300 a day.
- ShuoLab never moves the resource to a paid tier. Keep it on F0 in the Azure
  portal.

The in-app figure is an estimate. Also set budget alerts or hard limits in the
OpenAI and Azure consoles.
