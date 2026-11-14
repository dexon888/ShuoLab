import type { z } from "zod";
import { ApiError } from "./errors";

/** Parses a query string against a schema, or rejects with one readable message. */
export function parseQuery<S extends z.ZodType>(schema: S, query: Record<string, string>): z.infer<S> {
  const result = schema.safeParse(query);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") || "query";
    throw new ApiError("BAD_REQUEST", `Invalid "${field}" parameter.`);
  }
  return result.data;
}
