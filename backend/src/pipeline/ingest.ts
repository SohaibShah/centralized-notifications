import { resolveRecipients } from "../audience/recipients";
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
    // JSON.stringify neutralizes newlines/quotes in the (only length-bounded) module value so a
    // hostile publisher can't forge log lines — matches validate.ts's value-free logging discipline.
    console.warn(
      `[intake] rejected notification from unknown module ${JSON.stringify(result.data.module)}`,
    );
    return { status: "invalid" };
  }
  const status = await persist(result.data, !enabled);
  if (status === "accepted") {
    if (enabled) {
      // Deliver only to the addressed audience: global fans out to all connected subscribers,
      // team/role/user goes to the resolved recipient set (empty set = no live socket, still persisted).
      const recipients = await resolveRecipients(result.data.audience);
      if (recipients === "all") deliveryHub.broadcast(result.data);
      else deliveryHub.publishToRecipients(recipients, result.data);
    }
    // Best-effort recency bump; a failure here must never abort an already-delivered notification.
    try {
      await touchModule(result.data.module);
    } catch (err) {
      console.error(`[intake] last_seen bump failed for ${result.data.module}`, err);
    }
  }
  return { status, id: result.data.id };
}
