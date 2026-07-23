import { reactive, ref } from "vue";
import type { Transport } from "../transport/types";

export interface FeatureFlags {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
}

/**
 * App-wide feature flags for UI gating (read by any user via GET /settings/features).
 * Admin edits them through the admin panel; this reads only. Flags default to enabled so the UI
 * never hides a feature just because the fetch hasn't returned yet.
 */
export function createSettingsState(deps: { transport: Transport }) {
  const flags = reactive<FeatureFlags>({
    aiSummaryEnabled: true,
    chatbotEnabled: true,
    groupingEnabled: true,
    actionsEnabled: true,
  });
  const loaded = ref(false);

  async function load(): Promise<void> {
    const data = await deps.transport.get<FeatureFlags>("/settings/features");
    Object.assign(flags, data);
    loaded.value = true;
  }

  return { flags, loaded, load };
}

export type SettingsState = ReturnType<typeof createSettingsState>;
