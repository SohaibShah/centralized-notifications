import { query } from "../db/pool";

/**
 * Bump a known module's `last_seen_at` (feeds the admin "recently active" sort). Update-only:
 * modules are a fixed, seeded catalog (migration 007), never auto-created — an unknown key is
 * a no-op here (0 rows updated) and is rejected upstream at intake.
 */
export async function touchModule(key: string): Promise<void> {
  await query("UPDATE modules SET last_seen_at = now() WHERE key = $1", [key]);
}
