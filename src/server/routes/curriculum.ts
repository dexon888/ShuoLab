import { Hono } from "hono";
import { z } from "zod";
import { curriculumItemsQuerySchema } from "../../shared/api";
import { HSK_BANDS } from "../../shared/curriculum";
import type { AppBindings } from "../auth/access";
import { getCurriculumFacets, getCurriculumItem, listCurriculumItems } from "../services/curriculum-items";
import { getCurriculumStatus } from "../services/curriculum-status";
import { flagItem, listFlags, unflagItem } from "../services/task-check";
import { flagRequestSchema } from "../../shared/task-check";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";
import { parseQuery } from "../validation/query";

const facetsQuerySchema = z.object({ band: z.enum(HSK_BANDS).optional() });

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
  .get("/items/:id", async (c) => c.json(await getCurriculumItem(c.env.DB, c.req.param("id"))))
  // Flags on unverified rows (SPEC §2.5 rule 8).
  .get("/flags", async (c) => c.json(await listFlags(c.env.DB)))
  .post("/items/:id/flag", async (c) => {
    const parsed = flagRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"note": "…"} with up to 300 characters, or {}.');
    return c.json({ flag: await flagItem(c.env.DB, c.req.param("id"), parsed.data.note || null) }, 201);
  })
  .delete("/items/:id/flag", async (c) => {
    await unflagItem(c.env.DB, c.req.param("id"));
    return c.json({ flag: null });
  });
