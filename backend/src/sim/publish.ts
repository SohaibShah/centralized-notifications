import type { NotificationService } from "@notifications/core";
import { simulate, type SimulateOptions } from "./simulator";

export interface PublishSummary {
  total: number;
  accepted: number;
  duplicate: number;
  invalid: number;
}

/**
 * Dev trigger: generate a simulated burst and drive it through the real intake pipeline (the
 * service) so notifications actually land in the DB. With a fixed `seed` the ids repeat, so a second
 * call reports every item as `duplicate` — an end-to-end demonstration of idempotency.
 */
export async function publishSimulated(
  service: NotificationService,
  opts: SimulateOptions = {},
): Promise<PublishSummary> {
  const batch = simulate(opts);
  const summary: PublishSummary = {
    total: batch.length,
    accepted: 0,
    duplicate: 0,
    invalid: 0,
  };
  for (const notification of batch) {
    const { status } = await service.ingest(notification);
    summary[status]++;
  }
  return summary;
}
