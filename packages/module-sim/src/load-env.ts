import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load environment from the monorepo-root .env regardless of the process cwd —
// `pnpm --filter` runs scripts from the package dir, not the repo root. The root
// is computed from this file's location (packages/module-sim/src -> ../../..), with
// the cwd .env as a fallback. Existing process.env vars are never overridden, so
// tests/CI that set vars explicitly always win. Import this once from an entrypoint.
//
// module-sim shares INTERNAL_INTAKE_TOKEN and MODULE_DISPATCH_TOKEN with the backend
// (see backend/src/config/load-env.ts, the same pattern) — both must read the same
// repo-root .env for the hub<->module dispatch/intake handshake to authenticate in dev.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({
  path: [path.join(repoRoot, ".env"), path.resolve(process.cwd(), ".env")],
  quiet: true,
});
