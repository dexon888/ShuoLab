import { Hono } from "hono";
import { z } from "zod";
import { planRequestSchema } from "../../shared/session";
import type { AppBindings } from "../auth/access";
import { getSession, listSessions, planSession } from "../services/sessions";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";
import { parseQuery } from "../validation/query";

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

export const sessionRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const query = parseQuery(listQuerySchema, c.req.query());
    return c.json(await listSessions(c.env.DB, query.limit));
  })
  .post("/plan", async (c) => {
    const parsed = planRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".");
      throw new ApiError(
        "BAD_REQUEST",
        issue?.code === "unrecognized_keys" || !field
          ? "A session plan request takes only durationMinutes, studyBand and freeChat."
          : `Invalid value for "${field}".`,
      );
    }
    const result = await planSession(c.env.DB, parsed.data);
    return c.json(result, result.reused ? 200 : 201);
  })
  .get("/:id", async (c) => c.json({ session: await getSession(c.env.DB, c.req.param("id")) }));
