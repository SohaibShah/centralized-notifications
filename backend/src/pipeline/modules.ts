import { query } from "../db/pool";

/** Title-case a module key for the default human label: `vendor_risk` → `Vendor Risk`. */
export function deriveLabel(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Record that `key` published. First sight inserts the module (enabled, auto-labelled);
 * afterwards only `last_seen_at` is bumped — an admin's enabled/label edits are preserved.
 * Idempotent (safe to call on every accepted notification).
 */
export async function upsertModuleSeen(key: string): Promise<void> {
  await query(
    `INSERT INTO modules (key, label) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET last_seen_at = now()`,
    [key, deriveLabel(key)],
  );
}
