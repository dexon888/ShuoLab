import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Runs src/server in workerd with local D1 during `vite dev` / `vite preview`.
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      // Registered from src/client/main.tsx so no inline script is needed (CSP).
      injectRegister: false,
      // The manifest is a static file: public/manifest.webmanifest (SPEC §13).
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        // Authenticated API responses are never cached or served offline (SPEC §4.2).
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
      },
    }),
  ],
});
