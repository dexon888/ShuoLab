/**
 * OpenAI Responses API adapter for the text tutor (SPEC §3, §6.4).
 *
 * The key is passed in from the Worker environment at request time and is
 * used only in the Authorization header. Nothing here logs a request, a
 * response or an error body. `store: false` asks OpenAI not to retain the
 * response for later retrieval.
 */
import { TUTOR_OUTPUT_JSON_SCHEMA } from "../../shared/tutor";
import { ProviderError, type TokenUsage, type TutorProvider, type TutorRawResult, type TutorRequest } from "./types";

const ENDPOINT = "https://api.openai.com/v1/responses";
/** SPEC §9.1: provider timeout 15–25 seconds. */
export const TUTOR_TIMEOUT_MS = 20_000;
/** A tutor turn is a few sentences plus short feedback. */
const MAX_OUTPUT_TOKENS = 900;

export interface TokenPrices {
  /** US dollars per million input tokens. */
  inputUsdPerMTok: number;
  /** US dollars per million output tokens. */
  outputUsdPerMTok: number;
}

export interface OpenAiTutorOptions {
  apiKey: string;
  model: string;
  prices: TokenPrices;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pulls the generated text out of a Responses API body. Null when the model refused or the output was cut off. */
export function readResponseText(body: unknown): string | null {
  if (!isRecord(body) || body.status !== "completed" || !Array.isArray(body.output)) return null;
  const parts: string[] = [];
  for (const item of body.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (part.type === "refusal") return null;
      if (part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
    }
  }
  const text = parts.join("");
  return text.length > 0 ? text : null;
}

export function readResponseUsage(body: unknown): TokenUsage {
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
  return { tokensIn: asCount(usage.input_tokens), tokensOut: asCount(usage.output_tokens) };
}

function kindForStatus(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  return "http";
}

export class OpenAiTutorProvider implements TutorProvider {
  readonly vendor = "OpenAI";
  readonly model: string;
  readonly mock = false;
  readonly paid = true;
  private readonly apiKey: string;
  private readonly prices: TokenPrices;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiTutorOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.prices = options.prices;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? TUTOR_TIMEOUT_MS;
  }

  async generate(request: TutorRequest): Promise<TutorRawResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          instructions: request.instructions,
          input: request.messages.map((m) => ({ role: m.role, content: m.content })),
          text: {
            format: { type: "json_schema", name: "tutor_turn", schema: TUTOR_OUTPUT_JSON_SCHEMA, strict: true },
          },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new ProviderError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }

    if (!response.ok) {
      // The body may describe the request; it is dropped unread.
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(kindForStatus(response.status));
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError("malformed");
    }
    return { text: readResponseText(body), usage: readResponseUsage(body) };
  }

  /** Cached input is billed lower by OpenAI; counting it at the full price keeps the estimate on the high side. */
  estimateUsd(usage: TokenUsage): number {
    return (usage.tokensIn * this.prices.inputUsdPerMTok + usage.tokensOut * this.prices.outputUsdPerMTok) / 1_000_000;
  }
}
