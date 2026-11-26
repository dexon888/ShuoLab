import { Hono } from "hono";
import { deleteAllRequestSchema, exportQuerySchema, DELETE_ALL_PHRASE } from "../../shared/owner-data";
import type { AppBindings } from "../auth/access";
import { dataSummary, deleteAllOwnerData, exportCsv, exportJson } from "../services/owner-data";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

function stamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** GET /export: a download, never cached. */
export const exportRoutes = new Hono<AppBindings>().get("/", async (c) => {
  const parsed = exportQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError("BAD_REQUEST", "Ask for ?format=json, or ?format=csv&table=<one of your data tables>.");
  const now = new Date();
  c.header("Cache-Control", "no-store");
  if (parsed.data.format === "json") {
    c.header("Content-Disposition", `attachment; filename="shuolab-export-${stamp(now)}.json"`);
    return c.json(await exportJson(c.env.DB, now));
  }
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="shuolab-${parsed.data.table}-${stamp(now)}.csv"`);
  return c.body(await exportCsv(c.env.DB, parsed.data.table));
});

/** GET and DELETE /my-data: what is stored, and removing all of it. */
export const myDataRoutes = new Hono<AppBindings>()
  .get("/", async (c) => c.json(await dataSummary(c.env.DB)))
  .delete("/", async (c) => {
    const parsed = deleteAllRequestSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) throw new ApiError("BAD_REQUEST", `To delete everything, send {"confirm": "${DELETE_ALL_PHRASE}"}.`);
    return c.json(await deleteAllOwnerData(c.env.DB));
  });
