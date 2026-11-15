import { Hono } from "hono";
import { speechUsageRequestSchema } from "../../shared/speech";
import type { AppBindings } from "../auth/access";
import type { Env } from "../env";
import { selectSpeechProvider } from "../providers/select";
import type { SpeechTokenProvider } from "../providers/types";
import { issueSpeechToken, recordSpeechUsage, speechLimits } from "../services/speech";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

export interface SpeechRouteDeps {
  /** Chooses the token issuer for a request. Tests pass a stand-in here. */
  speech?: (env: Env) => SpeechTokenProvider;
}

export function createSpeechRoutes(deps: SpeechRouteDeps = {}) {
  const speechFor = deps.speech ?? selectSpeechProvider;
  return (
    new Hono<AppBindings>()
      // A POST, not a GET: a token is never something a link or a cache should produce.
      .post("/token", async (c) => c.json(await issueSpeechToken(c.env.DB, speechFor(c.env), speechLimits(c.env))))
      .post("/usage", async (c) => {
        const parsed = speechUsageRequestSchema.safeParse(await readJsonBody(c.req.raw));
        if (!parsed.success) {
          throw new ApiError(
            "BAD_REQUEST",
            "Report one recognition as {clientEventId, kind: \"recognition\", audioSeconds} or one spoken reply as {clientEventId, kind: \"synthesis\", characters}.",
          );
        }
        // Counted whichever issuer is configured: the allowance is what matters.
        const vendor = speechFor(c.env).vendor;
        const result = await recordSpeechUsage(c.env.DB, parsed.data, vendor, speechLimits(c.env));
        return c.json(result, result.recorded ? 201 : 200);
      })
  );
}
