import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: { external: ["vue", "@notifications/shared"] },
  },
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    setupFiles: ["./src/test-setup.ts"],
    environment: "jsdom",
  },
});
