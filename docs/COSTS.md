# Costs

Target: no infrastructure cost within free tiers, and a small, capped provider
spend. None of this is guaranteed; provider prices and free allowances change.
Check the linked pages before going live.

## Today (Phase 0)

The app makes no paid calls. Local development uses fake providers.

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

## Controls arriving with the features that spend money

- Phase 2: `usage_events` ledger per provider call; soft warning at US$5 and a
  stop at US$10 of estimated monthly usage, both editable; the gate fails
  closed if usage cannot be calculated; rate limits on tutor turns.
- Phase 3: speech token rate limit; separate tracking of Azure free-tier
  minutes and characters; no automatic move to a paid tier.

The in-app figure is an estimate. Also set budget alerts or hard limits in the
OpenAI and Azure consoles.
