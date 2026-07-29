import { defineConfig } from "vitest/config";

// Unlike backend/vitest.config.ts, module-sim has no shared Postgres to race on
// (no DB dependency here), so it doesn't need a setup file or serialized file runs.
export default defineConfig({
  test: {},
});
