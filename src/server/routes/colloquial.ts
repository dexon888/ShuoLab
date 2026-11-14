import { Hono } from "hono";
import { colloquialQuerySchema } from "../../shared/api";
import type { AppBindings } from "../auth/access";
import { listColloquial } from "../services/colloquial";
import { parseQuery } from "../validation/query";

export const colloquialRoutes = new Hono<AppBindings>().get("/", async (c) => {
  const query = parseQuery(colloquialQuerySchema, c.req.query());
  return c.json(await listColloquial(c.env.DB, query));
});
