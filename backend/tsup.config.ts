import { defineConfig } from "tsup";

// The backend is bundled (not just transpiled) so its output is a single,
// self-contained ESM file that runs on Node without extension/loader gymnastics.
// This is what makes `moduleResolution: "Bundler"` honest here, and it keeps the
// "@notifications/shared as TS source" dev pattern working: shared is inlined into
// the bundle, while real runtime deps (fastify, ...) stay external in node_modules.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  noExternal: ["@notifications/shared"],
});
