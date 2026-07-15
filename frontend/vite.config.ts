import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// The backend owns the API + the SSE stream. Proxying these paths in dev keeps the
// session cookie same-origin (so EventSource and fetch both send it) and mirrors how
// a single-origin deployment behaves in production.
const backend = "http://localhost:3000";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/auth": backend,
      "/notifications": backend,
      // Trailing slash: proxy the admin/settings *API* sub-paths to the backend, but let
      // the bare `/admin` and `/settings` *page* routes fall through to the SPA (a hard
      // reload of those pages must serve index.html, not hit the backend).
      "/admin/": backend,
      "/settings/": backend,
      "/internal": backend,
      "/health": backend,
      // SSE: disable buffering so events stream through as they arrive.
      "/sse": { target: backend, changeOrigin: false, ws: false },
    },
  },
  // Vitest runs the unit specs under src/ only; e2e/ is Playwright's (it also uses
  // *.spec.ts, so scoping here keeps the two runners from picking up each other's files).
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    setupFiles: ["./src/test-setup.ts"],
    environment: "jsdom",
  },
});
