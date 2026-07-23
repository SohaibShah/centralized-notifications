<script setup lang="ts">
import { provide, toRef } from "vue";
import { createCookieTransport } from "../transport/cookie-transport";
import { connectSse as defaultConnectSse } from "../transport/sse";
import { createFeedState } from "../state/feed";
import { createChatState } from "../state/chat";
import { createSummaryState } from "../state/summary";
import { createSettingsState } from "../state/settings";
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
const summary = createSummaryState({ transport });
const feed = createFeedState({ transport, connectSse });
const chat = createChatState({ baseUrl });
const actions = createNotificationActions({ feed });
const panel = createPanelState();

const ctx: NotificationsContext = {
  feed,
  chat,
  summary,
  settings,
  toast,
  panel,
  actions,
  user: toRef(() => props.config.user),
  transport,
  baseUrl,
};
provide(NOTIFICATIONS_KEY, ctx);
</script>

<template>
  <div class="notifications-root"><slot /></div>
</template>
