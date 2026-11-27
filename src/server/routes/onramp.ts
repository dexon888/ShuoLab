import { Hono } from "hono";
import { onrampAnswerRequestSchema } from "../../shared/onramp";
import type { AppBindings } from "../auth/access";
import { answerUnit, onrampStatus } from "../services/onramp";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

/** The sound-system on-ramp (SPEC §5.9). */
export const onrampRoutes = new Hono<AppBindings>()
  .get("/", async (c) => c.json(await onrampStatus(c.env.DB)))
  .post("/answers", async (c) => {
    const parsed = onrampAnswerRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"unitId": "…", "answers": [...]}.');
    return c.json({ result: await answerUnit(c.env.DB, parsed.data.unitId, parsed.data.answers) }, 201);
  });
