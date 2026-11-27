import { Hono } from "hono";
import { answerTestRequestSchema, startTestRequestSchema } from "../../shared/assessment";
import type { AppBindings } from "../auth/access";
import { finishAssessment, getAssessment, listAssessments, startAssessment } from "../services/assessment";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

/** Band practice tests and monthly checkpoints (SPEC §6.5). */
export const testRoutes = new Hono<AppBindings>()
  .get("/", async (c) => c.json(await listAssessments(c.env.DB)))
  .post("/", async (c) => {
    const parsed = startTestRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"band": "1"…"7-9", "kind": "band_test" or "checkpoint"}.');
    return c.json({ assessment: await startAssessment(c.env.DB, parsed.data.band, parsed.data.kind) }, 201);
  })
  .get("/:id", async (c) => c.json({ assessment: await getAssessment(c.env.DB, c.req.param("id")) }))
  .post("/:id/answers", async (c) => {
    const parsed = answerTestRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"answers": [...]}: an option number or text per question, or null to skip.');
    return c.json({ assessment: await finishAssessment(c.env.DB, c.req.param("id"), parsed.data.answers, parsed.data.spoken) });
  });
