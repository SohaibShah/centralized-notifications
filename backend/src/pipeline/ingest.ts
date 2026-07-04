import type { IngestResult } from "../intake/boundary";
import { persist } from "./persist";
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
  const status = await persist(result.data);
  return { status, id: result.data.id };
}
