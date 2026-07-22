import "../config/load-env";
import { closePool } from "../db/pool";
import { createReferenceService } from "../reference/service";
import { publishSimulated } from "../sim/publish";

// Dev CLI: `pnpm --filter @notifications/backend sim:publish [count] [seed]`
// Pass a fixed seed to prove idempotency (re-running reports every item as duplicate).
if (process.env.NODE_ENV === "production") {
  console.error("sim:publish is a dev tool and refuses to run with NODE_ENV=production");
  process.exit(1);
}

const count = process.argv[2] ? Number(process.argv[2]) : 20;
const seed = process.argv[3] ? Number(process.argv[3]) : undefined;

const service = createReferenceService();
service
  .ready()
  .then(() => publishSimulated(service, { count, seed }))
  .then((summary) => {
    console.log("published simulated notifications:", summary);
    return closePool();
  })
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
