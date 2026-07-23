/**
 * The intake boundary contract — the transport-agnostic result every producer path reports. A
 * transport (HTTP now, a Redis consumer later) adapts its wire format to `unknown` and calls
 * `ingest`; the pipeline owns validate -> dedupe -> persist and returns one of these per notification.
 */
export type IngestStatus =
  | "accepted" // validated and newly persisted
  | "duplicate" // validated but the id already existed (idempotent no-op)
  | "invalid"; // failed contract validation or unknown module — logged, not persisted, never thrown

export interface IngestResult {
  status: IngestStatus;
  /** Present for accepted/duplicate (the notification id); absent for invalid. */
  id?: string;
}
