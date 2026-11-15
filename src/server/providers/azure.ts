/**
 * Azure AI Speech token issuer (SPEC §4.1, §7.1). Exchanges the resource key
 * for a 10-minute access token at the regional STS endpoint. The key is
 * passed in from the Worker environment at request time and is used only in
 * the request header. Nothing here logs the key, the token or a response.
 */
import { SPEECH_TOKEN_REUSE_SECONDS } from "../../shared/speech";
import { ProviderError, type SpeechToken, type SpeechTokenProvider } from "./types";

export const SPEECH_TOKEN_TIMEOUT_MS = 10_000;
/** Azure region names are short lowercase words such as `eastus` or `southeastasia`. */
const REGION_PATTERN = /^[a-z][a-z0-9]{1,39}$/;
/** A JWT: three base64url parts. Anything else is not a token. */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const MAX_TOKEN_LENGTH = 8192;

export function isValidAzureRegion(region: string): boolean {
  return REGION_PATTERN.test(region);
}

export interface AzureSpeechOptions {
  key: string;
  region: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class AzureSpeechTokenProvider implements SpeechTokenProvider {
  readonly vendor = "Azure AI Speech";
  readonly mock = false;
  private readonly key: string;
  readonly region: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: AzureSpeechOptions) {
    if (!isValidAzureRegion(options.region)) {
      // The region becomes part of a URL; refuse anything that is not a plain name.
      throw new Error("Invalid Azure region.");
    }
    this.key = options.key;
    this.region = options.region;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? SPEECH_TOKEN_TIMEOUT_MS;
  }

  async issueToken(now: Date): Promise<SpeechToken> {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new ProviderError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new ProviderError("auth");
      if (response.status === 429) throw new ProviderError("rate_limited");
      throw new ProviderError("http");
    }

    const token = (await response.text().catch(() => "")).trim();
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !JWT_PATTERN.test(token)) {
      throw new ProviderError("malformed");
    }
    return {
      token,
      region: this.region,
      expiresAt: new Date(now.getTime() + SPEECH_TOKEN_REUSE_SECONDS * 1000).toISOString(),
    };
  }
}
