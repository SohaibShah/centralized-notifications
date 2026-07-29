import { defineConfig } from "tsup";

// Bundled (not just transpiled) so the output is a single self-contained ESM
// file that runs on Node directly — same rationale as backend/tsup.config.ts.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  noExternal: ["@notifications/shared"],
});
