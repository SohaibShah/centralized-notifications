import { deliveryHub } from "../delivery/hub";
import type { IngestResult } from "../intake/boundary";
import { upsertModuleSeen } from "./modules";
import { persist } from "./persist";
import { isModuleEnabled } from "./policy";
import { validate } from "./validate";

/**
 * The pipeline entry every transport calls: validate -> dedupe -> persist for one
 * notification. Malformed input is logged and returned as `invalid` — never thrown —
 * so a bad payload can't crash a batch or a stream consumer (NFR-3). Genuine
 * infrastructure errors (e.g. the DB is down) are *not* swallowed: they propagate so
 * the transport can surface a 5xx / leave a stream message pending for retry, which
 * is safe because persistence is idempotent on `id`.
 */
export async function ingest(raw: unknown): Promise<IngestResult> {
  const result = validate(raw);
  if (!result.ok) {
    console.warn(`[intake] rejected invalid notification (${result.error})`);
    return { status: "invalid" };
  }
  // Policy (FR-8): a disabled module's notification is recorded but not delivered.
  const delivered = await isModuleEnabled(result.data.module);
  const status = await persist(result.data, !delivered);
  if (status === "accepted") {
    // Fan out first — delivery must never be gated behind bookkeeping. Week-1 shortcut:
    // broadcast to everyone. Week 4 swaps this for resolveAudience -> publishToRecipients.
    // TODO(week-4): enforce per-recipient preferences/opt-out here before publishing
    // (notifications-domain.md) — the check belongs in this delivery path, not just the UI.
    if (delivered) deliveryHub.broadcast(result.data);
    // Auto-discover the source module (FR-7), best-effort. If this write throws, the caller
    // retries, persist returns "duplicate", and this block is skipped — so a discovery
    // failure must not abort an already-delivered notification. Discovery self-heals on the
    // module's next successful publish.
    try {
      await upsertModuleSeen(result.data.module);
    } catch (err) {
      console.error(`[intake] module discovery failed for ${result.data.module}`, err);
    }
  }
  return { status, id: result.data.id };
}
