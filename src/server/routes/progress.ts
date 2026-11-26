import { Hono } from "hono";
import { progressQuerySchema } from "../../shared/progress";
import type { AppBindings } from "../auth/access";
import { getProgressSummary } from "../services/progress";
import { parseQuery } from "../validation/query";

export const progressRoutes = new Hono<AppBindings>().get("/summary", async (c) => {
  const query = parseQuery(progressQuerySchema, c.req.query());
  return c.json(await getProgressSummary(c.env.DB, query.days));
});
