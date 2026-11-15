import { Hono } from "hono";
import { z } from "zod";
import { planRequestSchema, type SessionResponse } from "../../shared/session";
import { MAX_TRANSCRIPT_CHARS, turnRequestSchema } from "../../shared/tutor";
import type { AppBindings } from "../auth/access";
import type { Env } from "../env";
import { selectTutorProvider } from "../providers/select";
import type { TutorProvider } from "../providers/types";
import { getSession, listSessions, planSession } from "../services/sessions";
import { listTurns, takeTurn } from "../services/turns";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";
import { parseQuery } from "../validation/query";

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

export interface SessionRouteDeps {
  /** Chooses the tutor for a request. Tests pass a stand-in here. */
  tutor?: (env: Env) => TutorProvider;
}

export function createSessionRoutes(deps: SessionRouteDeps = {}) {
  const tutorFor = deps.tutor ?? selectTutorProvider;
  return new Hono<AppBindings>()
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
    .get("/:id", async (c) => {
      const session = await getSession(c.env.DB, c.req.param("id"));
      const body: SessionResponse = { session, turns: await listTurns(c.env.DB, session.id) };
      return c.json(body);
    })
    .post("/:id/turn", async (c) => {
      const parsed = turnRequestSchema.safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".");
        throw new ApiError(
          "BAD_REQUEST",
          issue?.code === "unrecognized_keys" || !field
            ? "A turn takes only clientTurnId, transcript, sourceMode and asrUncertain."
            : field === "transcript"
              ? `Write something, up to ${MAX_TRANSCRIPT_CHARS} characters.`
              : `Invalid value for "${field}".`,
        );
      }
      const result = await takeTurn(c.env.DB, tutorFor(c.env), c.req.param("id"), parsed.data);
      return c.json(result, result.replayed ? 200 : 201);
    });
}
