import { deliveryHub } from "../delivery/hub";
import type { IngestResult } from "../intake/boundary";
import { touchModule } from "./modules";
import { persist } from "./persist";
import { resolveModule } from "./policy";
import { validate } from "./validate";

/**
 * The pipeline entry every transport calls: validate -> resolve module -> persist for one
 * notification. Malformed input and unknown modules are logged and returned as `invalid` —
 * never thrown — so a bad payload can't crash a batch or a stream consumer (NFR-3). Genuine
 * infrastructure errors propagate so the transport can 5xx / leave a stream message pending;
 * that's safe because persistence is idempotent on `id`.
 */
export async function ingest(raw: unknown): Promise<IngestResult> {
  const result = validate(raw);
  if (!result.ok) {
    console.warn(`[intake] rejected invalid notification (${result.error})`);
    return { status: "invalid" };
  }
  // Modules are a fixed, seeded catalog (migration 007). An unknown key is a bug in the
  // calling module, so reject + log it — never persist, never deliver.
  const { known, enabled } = await resolveModule(result.data.module);
  if (!known) {
    console.warn(`[intake] rejected notification from unknown module "${result.data.module}"`);
    return { status: "invalid" };
  }
  const status = await persist(result.data, !enabled);
  if (status === "accepted") {
    if (enabled) deliveryHub.broadcast(result.data);
    // Best-effort recency bump; a failure here must never abort an already-delivered notification.
    try {
      await touchModule(result.data.module);
    } catch (err) {
      console.error(`[intake] last_seen bump failed for ${result.data.module}`, err);
    }
  }
  return { status, id: result.data.id };
}
