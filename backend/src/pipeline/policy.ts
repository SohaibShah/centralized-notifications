import { query } from "../db/pool";

export interface FeatureFlags {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
}

interface PolicyState {
  disabledModules: Set<string>;
  flags: FeatureFlags;
}

let cache: PolicyState | null = null;

async function load(): Promise<PolicyState> {
  const disabled = await query<{ key: string }>("SELECT key FROM modules WHERE enabled = false");
  const settings = await query<{
    ai_summary_enabled: boolean;
    chatbot_enabled: boolean;
    grouping_enabled: boolean;
    actions_enabled: boolean;
  }>(
    `SELECT ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled
       FROM global_settings WHERE id = true`,
  );
  const s = settings.rows[0];
  return {
    disabledModules: new Set(disabled.rows.map((r) => r.key)),
    flags: {
      aiSummaryEnabled: s?.ai_summary_enabled ?? true,
      chatbotEnabled: s?.chatbot_enabled ?? true,
      groupingEnabled: s?.grouping_enabled ?? true,
      actionsEnabled: s?.actions_enabled ?? true,
    },
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

export async function getFeatureFlags(): Promise<FeatureFlags> {
  return (await get()).flags;
}

/** Drop the cache; the next read reloads from the DB. Call after any admin write. */
export function invalidatePolicyCache(): void {
  cache = null;
}
