import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Drop + recreate + migrate the dedicated core test DB once per run (see test/global-setup.ts).
    globalSetup: ["./test/global-setup.ts"],
    // Suites share one Postgres; run test FILES serially so they don't race on the common
    // tables. Mirrors the backend's vitest config for the same reason.
    fileParallelism: false,
  },
});
