import { query } from "../db/pool";

export interface FeatureFlags {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
}

interface PolicyState {
  knownModules: Set<string>;
  disabledModules: Set<string>;
  flags: FeatureFlags;
  retentionDays: number;
}

let cache: PolicyState | null = null;

async function load(): Promise<PolicyState> {
  const mods = await query<{ key: string; enabled: boolean }>("SELECT key, enabled FROM modules");
  const settings = await query<{
    ai_summary_enabled: boolean;
    chatbot_enabled: boolean;
    grouping_enabled: boolean;
    actions_enabled: boolean;
    retention_days: number;
  }>(
    `SELECT ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled, retention_days
       FROM global_settings WHERE id = true`,
  );
  const s = settings.rows[0];
  return {
    knownModules: new Set(mods.rows.map((r) => r.key)),
    disabledModules: new Set(mods.rows.filter((r) => !r.enabled).map((r) => r.key)),
    flags: {
      aiSummaryEnabled: s?.ai_summary_enabled ?? true,
      chatbotEnabled: s?.chatbot_enabled ?? true,
      groupingEnabled: s?.grouping_enabled ?? true,
      actionsEnabled: s?.actions_enabled ?? true,
    },
    retentionDays: s?.retention_days ?? 30,
  };
}

async function get(): Promise<PolicyState> {
  if (!cache) cache = await load();
  return cache;
}

/** A module is enabled unless it is explicitly disabled (a never-seen module is enabled). */
export async function isModuleEnabled(key: string): Promise<boolean> {
  const state = await get();
  return !state.disabledModules.has(key);
}

/**
 * Known + enabled state for a module key, from the policy cache. Modules are a fixed, seeded
 * catalog (migration 007) — an unknown key is rejected at intake, not auto-created.
 */
export async function resolveModule(key: string): Promise<{ known: boolean; enabled: boolean }> {
  const state = await get();
  return { known: state.knownModules.has(key), enabled: !state.disabledModules.has(key) };
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  return (await get()).flags;
}

/** Retention window in days (config only; Week-5 partitioning enforces it). Admin-facing. */
export async function getRetentionDays(): Promise<number> {
  return (await get()).retentionDays;
}

/**
 * Drop the cache; the next read reloads from the DB. Call after any admin write.
 *
 * NOTE (single-instance assumption): this only clears the cache in the process that served
 * the write. The prototype runs one backend process, so that's complete. If this is ever
 * scaled horizontally, an admin change on one instance won't invalidate the others — a
 * disabled module could keep delivering on a stale replica. The fix at that point is a
 * TTL here plus a Redis pub/sub invalidation channel (Redis is already a dependency).
 * Flagged for the mentor with the audience-model discussion.
 */
export function invalidatePolicyCache(): void {
  cache = null;
}
