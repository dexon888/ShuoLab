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
export function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return apiRequest("GET", path, schema);
}

/** PUTs a JSON body to a same-origin API route and validates the response. */
export function apiPut<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  return apiRequest("PUT", path, schema, body);
}

/** POSTs a JSON body to a same-origin API route and validates the response. */
export function apiPost<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  return apiRequest("POST", path, schema, body);
}

/** PATCHes a JSON body to a same-origin API route and validates the response. */
export function apiPatch<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  return apiRequest("PATCH", path, schema, body);
}

/** DELETEs a same-origin API route (with an optional JSON body) and validates the response. */
export function apiDelete<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  return apiRequest("DELETE", path, schema, body);
}

async function apiRequest<S extends z.ZodType>(
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE",
  path: string,
  schema: S,
  payload?: unknown,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers:
        payload === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "same-origin",
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
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
