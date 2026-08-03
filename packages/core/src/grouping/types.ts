import type { Notification } from "@notifications/shared";

/** A notification's group assignment. Same `key` ⇒ same stack. `label` is the stack heading. */
export interface GroupAssignment {
  key: string;
  label: string;
}

/**
 * Pluggable grouping algorithm. `keyFor` is pure and per-notification (the key is stamped once at
 * ingest). `null` ⇒ ungroupable → the notification renders as a standalone card. Swapping the
 * strategy re-keys only NEW notifications; run the backfill command to re-key existing rows.
 */
export interface GroupingStrategy {
  keyFor(n: Notification): GroupAssignment | null;
}
