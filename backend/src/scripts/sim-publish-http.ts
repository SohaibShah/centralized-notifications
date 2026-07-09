import "../config/load-env";
import { getEnv } from "../config/env";
import { simulate } from "../sim/simulator";

/**
 * Dev CLI: `pnpm --filter @notifications/backend sim:publish:http [count] [seed]`
 *
 * Unlike `sim:publish` (which drives `ingest` in *this* process — good for seeding the
 * DB), this POSTs the simulated burst to a *running* server's `POST /internal/publish`.
 * That routes through the same intake pipeline inside the server process, so the
 * delivery hub there fans it out live to connected SSE clients — the end-to-end path
 * the frontend live feed depends on. Point it elsewhere with INTAKE_URL.
 */
if (process.env.NODE_ENV === "production") {
  console.error("sim:publish:http is a dev tool and refuses to run with NODE_ENV=production");
  process.exit(1);
}

const count = process.argv[2] ? Number(process.argv[2]) : 20;
const seed = process.argv[3] ? Number(process.argv[3]) : undefined;
const baseUrl = process.env.INTAKE_URL ?? "http://localhost:3000";

async function main(): Promise<void> {
  const batch = simulate({ count, seed });
  const res = await fetch(`${baseUrl}/internal/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": getEnv().INTERNAL_INTAKE_TOKEN,
    },
    body: JSON.stringify(batch),
  });
  const body: unknown = await res.json().catch(() => null);
  console.log(`POST ${baseUrl}/internal/publish -> ${res.status}`, body);
  if (!res.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
