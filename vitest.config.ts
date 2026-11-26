import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const define = { __APP_VERSION__: JSON.stringify("test") };

export default defineConfig({
  test: {
    projects: [
      {
        define,
        test: {
          name: "server",
          environment: "node",
          include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
          // Integration tests drive a real local D1 engine; a test making a
          // dozen writes in a row can pass 5 s when every file runs at once.
          testTimeout: 20_000,
        },
      },
      {
        define,
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          globals: true,
          include: ["test/client/**/*.test.tsx"],
          setupFiles: ["test/client/setup.ts"],
        },
      },
    ],
  },
});
