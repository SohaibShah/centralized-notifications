import type { QueryFn } from "../db";
import type { DeliveryHub } from "../delivery/hub";
import type { PolicyStore } from "../policy/store";
import type { IngestResult } from "./boundary";
import { persist } from "./persist";
import { validate } from "./validate";

export interface IngestDeps {
  query: QueryFn;
  hub: DeliveryHub;
  policy: PolicyStore;
}

/**
 * The pipeline entry every transport calls: validate -> resolve module -> persist -> deliver for one
 * notification. Malformed input and unknown modules are logged and returned as `invalid` — never
 * thrown — so a bad payload can't crash a batch or a stream consumer. Genuine infrastructure errors
 * propagate so the transport can 5xx / leave a stream message pending; that's safe because
 * persistence is idempotent on `id`. Delivery is to the addressed audience via the hub (which matches
 * each connected subscriber's principal) — no recipient table lookup.
 */
export async function ingest(deps: IngestDeps, raw: unknown): Promise<IngestResult> {
  const result = validate(raw);
  if (!result.ok) {
    console.warn(`[intake] rejected invalid notification (${result.error})`);
    return { status: "invalid" };
  }
  const { known, enabled } = await deps.policy.resolveModule(result.data.module);
  if (!known) {
    // JSON.stringify neutralizes newlines/quotes in the (only length-bounded) module value so a
    // hostile publisher can't forge log lines — matches validate.ts's value-free logging discipline.
    console.warn(
      `[intake] rejected notification from unknown module ${JSON.stringify(result.data.module)}`,
    );
    return { status: "invalid" };
  }
  const status = await persist(deps.query, result.data, !enabled);
  if (status === "accepted") {
    if (enabled) deps.hub.publish(result.data);
    // Best-effort recency bump; a failure here must never abort an already-delivered notification.
    try {
      await deps.policy.touchModule(result.data.module);
    } catch (err) {
      console.error(`[intake] last_seen bump failed for ${result.data.module}`, err);
    }
  }
  return { status, id: result.data.id };
}
