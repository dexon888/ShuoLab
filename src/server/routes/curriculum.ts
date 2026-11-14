import { Hono } from "hono";
import { z } from "zod";
import { curriculumItemsQuerySchema } from "../../shared/api";
import { HSK_BANDS } from "../../shared/curriculum";
import type { AppBindings } from "../auth/access";
import { getCurriculumFacets, getCurriculumItem, listCurriculumItems } from "../services/curriculum-items";
import { getCurriculumStatus } from "../services/curriculum-status";
import { ApiError } from "../validation/errors";

const facetsQuerySchema = z.object({ band: z.enum(HSK_BANDS).optional() });

/** Parses a query string against a schema, or rejects with one readable message. */
function parseQuery<S extends z.ZodType>(schema: S, query: Record<string, string>): z.infer<S> {
  const result = schema.safeParse(query);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".") || "query";
    throw new ApiError("BAD_REQUEST", `Invalid "${field}" parameter.`);
  }
  return result.data;
}

export const curriculumRoutes = new Hono<AppBindings>()
  .get("/status", async (c) => c.json(await getCurriculumStatus(c.env.DB)))
  .get("/items", async (c) => {
    const query = parseQuery(curriculumItemsQuerySchema, c.req.query());
    return c.json(await listCurriculumItems(c.env.DB, query));
  })
  .get("/facets", async (c) => {
    const query = parseQuery(facetsQuerySchema, c.req.query());
    return c.json(await getCurriculumFacets(c.env.DB, query.band));
  })
  .get("/items/:id", async (c) => c.json(await getCurriculumItem(c.env.DB, c.req.param("id"))));
