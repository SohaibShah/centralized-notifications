import "../config/load-env";
import { closePool } from "../db/pool";
import { seedIdentity } from "../auth/seed";

// CLI: `pnpm --filter @notifications/backend seed` (run after `migrate`).
seedIdentity()
  .then(() => {
    console.log("identity seeded");
    return closePool();
  })
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
