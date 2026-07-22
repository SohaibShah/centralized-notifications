import { defineConfig } from "tsup";

// A library build (not an app bundle): emit ESM + type declarations, keep runtime deps
// (pg, zod, @notifications/shared) external so a consumer resolves them from their own
// node_modules. The dev pattern still points `exports` at TS source; this dist is what a
// published consumer would import.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
});
