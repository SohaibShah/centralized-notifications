import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Drop + recreate + migrate the plugin's own test DB once per run (see test/global-setup.ts).
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
  },
});
