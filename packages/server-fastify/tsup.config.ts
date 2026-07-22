import { defineConfig } from "tsup";

// Library build: ESM + type declarations, runtime deps (fastify, @notifications/core, zod) external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
});
