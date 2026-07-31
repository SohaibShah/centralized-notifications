<script setup lang="ts">
import { onMounted, provide, toRef } from "vue";
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

const props = defineProps<{ config: NotificationConfig }>();

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
// is current) and re-read the feed + counts — the change takes effect with no page reload. `feed` is
// declared just below; the callback only runs on later user action, by which point it's initialized.
const preferences = createPreferencesState({
  transport,
  onRulesChanged: () => {
    // Hard-reload (not merge) so a just-muted module's items actually leave the feed; `reload` also
    // refreshes the dataset-wide counts.
    void feed.reload();
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
