import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Every suite runs against one shared Postgres, so parallel test FILES race on the
    // common tables (users/modules/notifications) and the singleton pool — an intermittent
    // "1 failed file" with no deterministic cause. Run files serially; suites within a file
    // already run in order. (Speed cost is small; correctness on a shared DB is not optional.)
    fileParallelism: false,
  },
});
