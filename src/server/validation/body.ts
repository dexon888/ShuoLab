import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../auth/access";
import { ApiError } from "./errors";

/** Request bodies are small JSON documents; anything larger is refused unread. */
const MAX_BODY_BYTES = 16 * 1024;

/** Reads a JSON request body with a size cap. Never echoes the body in errors. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new ApiError("BAD_REQUEST", "Send the request body as JSON.");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    throw new ApiError("BAD_REQUEST", "The request is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError("BAD_REQUEST", "The request is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("BAD_REQUEST", "The request body is not valid JSON.");
  }
}

function isSameHost(origin: string, url: string): boolean {
  try {
    return new URL(origin).host === new URL(url).host;
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses state-changing requests that a browser sent from another site.
 * Browsers attach Origin to cross-site writes; it must match this app's host.
 */
export function sameOriginWrites(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("Origin");
      if (origin !== undefined && !isSameHost(origin, c.req.url)) {
        throw new ApiError("FORBIDDEN", "This request did not come from ShuoLab.");
      }
    }
    await next();
  };
}
