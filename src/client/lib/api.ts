import type { z } from "zod";
import { API_PREFIX, errorEnvelopeSchema, type ErrorCode } from "../../shared/api";

export class ApiRequestError extends Error {
  readonly code: ErrorCode | "NETWORK" | "UNEXPECTED_RESPONSE";
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: ApiRequestError["code"],
    message: string,
    status: number | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** GETs a same-origin API route and validates the response against its contract. */
export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiRequestError(
      "NETWORK",
      "Can't reach ShuoLab. Check your connection and try again.",
      null,
      true,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Typically an expired Cloudflare Access session answering with a sign-in page.
    throw new ApiRequestError(
      "UNEXPECTED_RESPONSE",
      "Your sign-in may have expired. Reload the page to sign in again.",
      response.status,
      false,
    );
  }

  if (!response.ok) {
    const envelope = errorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      const { code, message, retryable } = envelope.data.error;
      throw new ApiRequestError(code, message, response.status, retryable);
    }
    throw new ApiRequestError("UNEXPECTED_RESPONSE", "ShuoLab returned an unexpected error.", response.status, true);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError(
      "UNEXPECTED_RESPONSE",
      "ShuoLab returned data this version of the app doesn't understand. Reload to update.",
      response.status,
      false,
    );
  }
  return parsed.data;
}
