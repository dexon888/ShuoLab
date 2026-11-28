import { Hono } from "hono";
import { pronunciationAttemptRequestSchema } from "../../shared/pronunciation";
import type { AppBindings } from "../auth/access";
import { pronunciationSummary, recordAttempt } from "../services/pronunciation";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

/** Shadowing scores (SPEC §7.3, FR-039). Scores only: no audio is ever sent here. */
export const pronunciationRoutes = new Hono<AppBindings>()
  .get("/summary", async (c) => c.json(await pronunciationSummary(c.env.DB)))
  .post("/attempts", async (c) => {
    const parsed = pronunciationAttemptRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw new ApiError("BAD_REQUEST", "Send the reference text, the scores and the per-character results.");
    return c.json(await recordAttempt(c.env.DB, parsed.data), 201);
  });
