import type { ErrorCode, ErrorEnvelope } from "../../shared/api";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

const STATUS_BY_CODE: Record<ErrorCode, ErrorStatus> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CURRICULUM_MISSING: 503,
  PROVIDER_UNAVAILABLE: 503,
  AUTH_NOT_CONFIGURED: 503,
  CONFIG_INVALID: 500,
  INTERNAL: 500,
};

/**
 * An error that is safe to show to the client. Messages are authored here —
 * never copied from provider errors, tokens, cookies or prompts (SPEC §9.1).
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = retryable;
  }

  get status(): ErrorStatus {
    return STATUS_BY_CODE[this.code];
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}
