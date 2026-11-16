import { speechTokenResponseSchema, type SpeechAllowance, type SpeechTokenResponse } from "../../shared/speech";
import { apiPost } from "../lib/api";

/** Ask for a new token this long before the server's refresh time. */
const MARGIN_MS = 30_000;

/**
 * Holds the current speech token in memory only (SPEC §4.1). A token is
 * fetched when speech is about to be used and reused until shortly before it
 * expires. Nothing polls in the background.
 */
export class SpeechTokenSource {
  private current: SpeechTokenResponse | null = null;
  private inflight: Promise<SpeechTokenResponse> | null = null;
  private readonly fetchToken: () => Promise<SpeechTokenResponse>;
  private readonly now: () => number;

  constructor(
    fetchToken: () => Promise<SpeechTokenResponse> = () => apiPost("/speech/token", {}, speechTokenResponseSchema),
    now: () => number = () => Date.now(),
  ) {
    this.fetchToken = fetchToken;
    this.now = now;
  }

  /** The allowance from the most recent token, or null before the first. */
  get allowance(): SpeechAllowance | null {
    return this.current?.allowance ?? null;
  }

  setAllowance(allowance: SpeechAllowance): void {
    if (this.current) this.current = { ...this.current, allowance };
  }

  async get(): Promise<SpeechTokenResponse> {
    if (this.current && this.now() < Date.parse(this.current.expiresAt) - MARGIN_MS) return this.current;
    // Two callers at once share one request.
    this.inflight ??= this.fetchToken().then(
      (token) => {
        this.current = token;
        this.inflight = null;
        return token;
      },
      (error: unknown) => {
        this.inflight = null;
        throw error;
      },
    );
    return this.inflight;
  }

  /** Forget the token, for example after Azure rejected it. */
  invalidate(): void {
    this.current = null;
  }
}
