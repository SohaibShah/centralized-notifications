import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// The happy-path e2e publishes a notification through POST /internal/publish, which
// requires the shared internal token. Take it from the process env if set, else read it
// from the monorepo-root .env (the same file the backend loads — a documented local dev
// value, not a committed secret). If neither is present the spec fails with a clear msg.
if (!process.env.INTERNAL_INTAKE_TOKEN) {
  try {
    const envFile = readFileSync(path.join(repoRoot, ".env"), "utf8");
    const match = envFile.match(/^\s*INTERNAL_INTAKE_TOKEN\s*=\s*(.*)$/m);
    if (match) process.env.INTERNAL_INTAKE_TOKEN = match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // Leave unset; the spec surfaces the requirement.
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Bring up Postgres-backed dev stack for the run. Assumes `docker compose up -d`
  // (Postgres) is already running; migrate + seed are idempotent, then `pnpm dev` serves
  // both apps. Reuses an already-running dev server locally.
  webServer: {
    command:
      "pnpm --filter @notifications/backend migrate && pnpm --filter @notifications/backend seed && pnpm dev",
    cwd: repoRoot,
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
