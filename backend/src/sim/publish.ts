import { ingest } from "../pipeline/ingest";
import { simulate, type SimulateOptions } from "./simulator";

export interface PublishSummary {
  total: number;
  accepted: number;
  duplicate: number;
  invalid: number;
}

/**
 * Dev trigger: generate a simulated burst (Task 4) and drive it through the real
 * intake pipeline (Task 5) so notifications actually land in the DB before real
 * modules / the frontend exist. With a fixed `seed` the ids repeat, so a second call
 * reports every item as `duplicate` — an end-to-end demonstration of idempotency.
 */
export async function publishSimulated(opts: SimulateOptions = {}): Promise<PublishSummary> {
  const batch = simulate(opts);
  const summary: PublishSummary = {
    total: batch.length,
    accepted: 0,
    duplicate: 0,
    invalid: 0,
  };
  for (const notification of batch) {
    const { status } = await ingest(notification);
    summary[status]++;
  }
  return summary;
}
