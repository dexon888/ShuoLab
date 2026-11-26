import { Hono } from "hono";
import { dueQuerySchema, rateRequestSchema } from "../../shared/review";
import type { AppBindings } from "../auth/access";
import { listDue, rateCard } from "../services/review";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";
import { parseQuery } from "../validation/query";

export const reviewRoutes = new Hono<AppBindings>()
  .get("/due", async (c) => {
    const query = parseQuery(dueQuerySchema, c.req.query());
    return c.json(await listDue(c.env.DB, query.limit));
  })
  .post("/:id/rate", async (c) => {
    const parsed = rateRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) {
      throw new ApiError("BAD_REQUEST", 'Send {"rating": "again" | "hard" | "good" | "easy", "clientEventId": "<uuid>"}.');
    }
    const result = await rateCard(c.env.DB, c.req.param("id"), parsed.data);
    return c.json(result, result.replayed ? 200 : 201);
  });
