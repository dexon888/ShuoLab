import { Hono } from "hono";
import { newStoryRequestSchema, storyAnswersRequestSchema, storyFinishRequestSchema } from "../../shared/stories";
import type { AppBindings } from "../auth/access";
import type { Env } from "../env";
import { selectTutorProvider } from "../providers/select";
import type { TutorProvider } from "../providers/types";
import { answerStory, createStory, finishStory, getStory, listStories, revealStory } from "../services/stories";
import { readJsonBody } from "../validation/body";
import { ApiError } from "../validation/errors";

/** Graded stories and dialogues (SPEC §5.10). */
export function createStoryRoutes(deps: { tutor?: (env: Env) => TutorProvider } = {}) {
  const tutorFor = deps.tutor ?? selectTutorProvider;
  return new Hono<AppBindings>()
    .get("/", async (c) => c.json(await listStories(c.env.DB)))
    .post("/", async (c) => {
      const parsed = newStoryRequestSchema.safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"kind": "story" or "dialogue"}.');
      return c.json({ story: await createStory(c.env.DB, tutorFor(c.env), parsed.data.kind, parsed.data.continueSeries) }, 201);
    })
    .get("/:id", async (c) => c.json({ story: await getStory(c.env.DB, c.req.param("id")) }))
    .post("/:id/answers", async (c) => {
      const parsed = storyAnswersRequestSchema.safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"answers": [...]}.');
      return c.json({ story: await answerStory(c.env.DB, c.req.param("id"), parsed.data.answers) });
    })
    .post("/:id/reveal", async (c) => c.json({ story: await revealStory(c.env.DB, c.req.param("id")) }))
    .post("/:id/finish", async (c) => {
      const parsed = storyFinishRequestSchema.safeParse(await readJsonBody(c.req.raw));
      if (!parsed.success) throw new ApiError("BAD_REQUEST", 'Send {"minutes": 0-60}.');
      return c.json({ story: await finishStory(c.env.DB, c.req.param("id"), parsed.data.minutes) });
    });
}
