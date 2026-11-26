import { Hono } from "hono";
import { settingsUpdateSchema, type SettingsResponse } from "../../shared/settings";
import type { AppBindings } from "../auth/access";
import { applyRetention } from "../services/owner-data";
import { getSettings, updateSettings } from "../services/settings";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

export const settingsRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const body: SettingsResponse = { settings: await getSettings(c.env.DB) };
    return c.json(body);
  })
  .put("/", async (c) => {
    const parsed = settingsUpdateSchema.safeParse(await readJsonBody(c.req.raw));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".");
      // Unknown fields are rejected, not ignored: the schema is the whitelist.
      throw new ApiError(
        "BAD_REQUEST",
        issue?.code === "unrecognized_keys"
          ? "That setting cannot be changed here."
          : field
            ? `Invalid value for "${field}".`
            : "Nothing to update.",
      );
    }
    const body: SettingsResponse = { settings: await updateSettings(c.env.DB, parsed.data) };
    // A shorter retention takes effect at once.
    if (parsed.data.transcriptRetentionDays !== undefined) await applyRetention(c.env.DB);
    return c.json(body);
  });
