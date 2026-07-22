import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Suites share one Postgres; run test FILES serially so they don't race on the common
    // tables. Mirrors the backend's vitest config for the same reason.
    fileParallelism: false,
  },
});
