import { inject, type InjectionKey, type Ref } from "vue";
import type { Transport, SseFactory } from "../transport/types";
import type { createFeedState } from "../state/feed";
import type { createChatState } from "../state/chat";
import type { createSummaryState } from "../state/summary";
import type { createSettingsState } from "../state/settings";
import type { createToastState } from "../state/toast";
import type { createPanelState } from "../state/panel";
import type { createNotificationActions } from "../state/actions";

/** The host's identity, injected for UI gating only (e.g. admin surfaces). The server still enforces
 *  audience/admin via the carried credential — the library never derives identity. */
export interface NotificationUser {
  roles: string[];
  teamKeys?: string[];
}

/** What a host passes to <NotificationProvider>. `baseUrl` + the defaults cover a same-origin/cookie
 *  host; `transport`/`connectSse` override for token/bearer auth or a custom client. */
export interface NotificationConfig {
  baseUrl?: string;
  transport?: Transport;
  connectSse?: SseFactory;
  user: NotificationUser | null;
}

export interface NotificationsContext {
  feed: ReturnType<typeof createFeedState>;
  chat: ReturnType<typeof createChatState>;
  summary: ReturnType<typeof createSummaryState>;
  settings: ReturnType<typeof createSettingsState>;
  toast: ReturnType<typeof createToastState>;
  panel: ReturnType<typeof createPanelState>;
  actions: ReturnType<typeof createNotificationActions>;
  user: Ref<NotificationUser | null>;
  transport: Transport;
  baseUrl: string;
}

export const NOTIFICATIONS_KEY: InjectionKey<NotificationsContext> = Symbol("notifications");

export function useNotifications(): NotificationsContext {
  const ctx = inject(NOTIFICATIONS_KEY);
  if (!ctx) throw new Error("useFeed()/useChat()/… must be used inside <NotificationProvider>.");
  return ctx;
}

export const useFeed = () => useNotifications().feed;
export const useChat = () => useNotifications().chat;
export const useSummary = () => useNotifications().summary;
export const useSettings = () => useNotifications().settings;
export const useToast = () => useNotifications().toast;
export const usePanel = () => useNotifications().panel;
export const useActions = () => useNotifications().actions;
export const useUser = () => useNotifications().user;
export const useTransport = () => useNotifications().transport;
