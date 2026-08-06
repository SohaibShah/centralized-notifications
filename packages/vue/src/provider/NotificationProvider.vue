<script setup lang="ts">
import { computed, onMounted, provide, toRef } from "vue";
import { createCookieTransport } from "../transport/cookie-transport";
import { connectSse as defaultConnectSse } from "../transport/sse";
import { createFeedState } from "../state/feed";
import { createChatState } from "../state/chat";
import { createSummaryState } from "../state/summary";
import { createSettingsState } from "../state/settings";
import { createPreferencesState } from "../state/preferences";
import { createToastState } from "../state/toast";
import { createPanelState } from "../state/panel";
import { createNotificationActions } from "../state/actions";
import { NOTIFICATIONS_KEY, type NotificationConfig, type NotificationsContext } from "./context";
import { NOTIFICATION_UI_KEY, type NotificationUi } from "../theming/useUi";
import { NOTIFICATION_ICONS_KEY, defaultIcons, type IconRegistry } from "../theming/icons";

// `config` carries data/identity; `ui`/`icons` are the appearance surface — kept as their own
// props so "what data" and "how it looks" stay separate at the call site.
const props = defineProps<{
  config: NotificationConfig;
  ui?: NotificationUi;
  icons?: IconRegistry;
}>();

// The connection fields (baseUrl/transport/connectSse) are resolved ONCE at setup — state is built a
// single time. Only `config.user` is live (see the reactive `toRef` below); a host that reactively
// swaps baseUrl/transport after mount would need to remount the provider.
const baseUrl = props.config.baseUrl ?? "";
const transport = props.config.transport ?? createCookieTransport(baseUrl);
const connectSse = props.config.connectSse ?? ((opts) => defaultConnectSse(baseUrl, opts));

// Build the state once. Order: leaf state first, then the coordinators that depend on siblings.
const toast = createToastState();
const settings = createSettingsState({ transport });
// When a snooze/mute rule is persisted, reconnect the live stream (so its server-side rule snapshot
// is current — otherwise the hub keeps pushing a just-muted module's items until the next heartbeat,
// which `addFront` would prepend right back after a reload) and hard-reload the feed + counts. The
// change then takes effect with no page reload. `feed` is declared just below; the callback only runs
// on later user action, by which point it's initialized.
const preferences = createPreferencesState({
  transport,
  onRulesChanged: () => {
    feed.disconnect();
    feed.connect(); // re-subscribe so the SSE handler re-reads the mute rules at connect time
    void feed.reload(); // hard-clear + refetch + counts (unlike the merging load())
  },
});
const summary = createSummaryState({ transport });
const feed = createFeedState({ transport, connectSse });
const chat = createChatState({ baseUrl });
const actions = createNotificationActions({ feed, transport, settings });
const panel = createPanelState();

const ctx: NotificationsContext = {
  feed,
  chat,
  summary,
  settings,
  preferences,
  toast,
  panel,
  actions,
  user: toRef(() => props.config.user),
  transport,
  baseUrl,
};
provide(NOTIFICATIONS_KEY, ctx);

// Appearance surface, provided reactively so a host can swap themes at runtime. `ui` flows to every
// component's useUi(); `icons` is the default registry merged with the host's overrides by name.
provide(
  NOTIFICATION_UI_KEY,
  computed(() => props.ui),
);
provide(
  NOTIFICATION_ICONS_KEY,
  computed(() => ({ ...defaultIcons, ...(props.icons ?? {}) })),
);

// Load per-user preferences up front (not just when the settings page opens) so the critical-toast
// preference and grouping toggle are live everywhere — the toast viewport is mounted app-wide and
// reads `preferences.prefs.toastMinPriority`. Best-effort; the store keeps its defaults on failure.
// (Live re-fetch on a mute/snooze change is handled by `onRulesChanged` above, which fires after the
// write is persisted — not here.)
onMounted(() => {
  void preferences.load().catch(() => {});
});
</script>

<template>
  <div class="notifications-root"><slot /></div>
</template>
