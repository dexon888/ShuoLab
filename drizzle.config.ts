import { defineConfig } from "drizzle-kit";

// Used only to generate SQL migrations from the schema (`pnpm db:generate`).
// Migrations are applied by Wrangler (`pnpm db:migrate:local|remote`).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
});
