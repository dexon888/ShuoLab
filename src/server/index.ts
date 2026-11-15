import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { API_PREFIX, type HealthResponse, type MeResponse } from "../shared/api";
import { configGuard, requireOwner, type AppBindings, type AuthDeps } from "./auth/access";
import { APP_VERSION } from "./env";
import { getProviderStatuses } from "./providers/status";
import { colloquialRoutes } from "./routes/colloquial";
import { curriculumRoutes } from "./routes/curriculum";
import { createSessionRoutes, type SessionRouteDeps } from "./routes/sessions";
import { settingsRoutes } from "./routes/settings";
import { getCurriculumStatus, isVocabVerified } from "./services/curriculum-status";
import { getSettings } from "./services/settings";
import { getMonthlyUsage } from "./services/usage";
import { sameOriginWrites } from "./validation/body";
import { ApiError } from "./validation/errors";

export interface AppDeps {
  auth?: AuthDeps;
  tutor?: SessionRouteDeps["tutor"];
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppBindings>();

  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    await next();
    // API responses are per-owner and must never be cached by shared caches.
    c.header("Cache-Control", "no-store");
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toEnvelope(), err.status);
    }
    // Log the name only: messages may contain provider or request details.
    console.error("Unhandled API error:", err instanceof Error ? err.name : "unknown");
    return c.json(new ApiError("INTERNAL", "Something went wrong. Try again.", true).toEnvelope(), 500);
  });

  app.notFound((c) =>
    c.json(new ApiError("NOT_FOUND", "No such API route.").toEnvelope(), 404),
  );

  const api = new Hono<AppBindings>();
  api.use("*", configGuard());
  api.use("*", sameOriginWrites());

  // Public: safe status only — no user info, no database or secret details.
  api.get("/health", (c) => {
    const body: HealthResponse = { ready: true, version: APP_VERSION };
    return c.json(body);
  });

  // Everything below requires the verified owner.
  api.use("*", requireOwner(deps.auth));

  api.get("/me", async (c) => {
    const owner = c.get("owner");
    const [status, settings] = await Promise.all([getCurriculumStatus(c.env.DB), getSettings(c.env.DB)]);
    const body: MeResponse = {
      owner,
      settings,
      providers: getProviderStatuses(c.env),
      curriculumImported: isVocabVerified(status),
      version: APP_VERSION,
    };
    return c.json(body);
  });

  api.route("/settings", settingsRoutes);
  api.route("/sessions", createSessionRoutes({ tutor: deps.tutor }));
  // This app's own estimate of the month's spending; not a provider bill.
  api.get("/usage/monthly", async (c) => c.json(await getMonthlyUsage(c.env.DB)));
  api.route("/curriculum", curriculumRoutes);
  // Separate from the syllabus: never part of an HSK count.
  api.route("/colloquial", colloquialRoutes);

  app.route(API_PREFIX, api);
  return app;
}

// Hono apps expose `fetch`, which is the Worker entry point.
export default createApp();
