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
