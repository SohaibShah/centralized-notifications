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
  const summaryTime = ref("08:00");
  const loaded = ref(false);

  async function load(): Promise<void> {
    const data = await deps.transport.get<FeatureFlags & { summaryTime?: string }>(
      "/settings/features",
    );
    flags.aiSummaryEnabled = data.aiSummaryEnabled;
    flags.chatbotEnabled = data.chatbotEnabled;
    flags.groupingEnabled = data.groupingEnabled;
    flags.actionsEnabled = data.actionsEnabled;
    if (data.summaryTime) summaryTime.value = data.summaryTime;
    loaded.value = true;
  }

  return reactive({ flags, summaryTime, loaded, load });
}

export type SettingsState = ReturnType<typeof createSettingsState>;
