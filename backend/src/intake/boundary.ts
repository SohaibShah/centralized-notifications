/**
 * The intake boundary — the transport-agnostic contract every producer publishes
 * through (the HTTP route now; the Week-5 Redis consumer later, implementing the
 * same interface with no pipeline rewrite). Transports adapt their wire format to
 * `unknown` and call the pipeline's `ingest`; the pipeline owns validate -> dedupe
 * -> persist and reports one of these outcomes per notification.
 */

/** Per-notification outcome of the pipeline. */
export type IngestStatus =
  | "accepted" // validated and newly persisted
  | "duplicate" // validated but the id already existed (idempotent no-op)
  | "invalid"; // failed contract validation — logged, not persisted, never thrown

export interface IngestResult {
  status: IngestStatus;
  /** Present for accepted/duplicate (the notification id); absent for invalid. */
  id?: string;
}

export interface IntakeBoundary {
  publish(raw: unknown): Promise<IngestResult>;
}
