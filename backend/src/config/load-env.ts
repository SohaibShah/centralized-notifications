import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load environment from the monorepo-root .env regardless of the process cwd —
// `pnpm --filter` runs scripts from the package dir, not the repo root. The root
// is computed from this file's location (backend/src/config -> ../../..), with the
// cwd .env as a fallback. Existing process.env vars are never overridden, so
// tests/CI that set vars explicitly always win. Import this once from an entrypoint.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({
  path: [path.join(repoRoot, ".env"), path.resolve(process.cwd(), ".env")],
  quiet: true,
});
