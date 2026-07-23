// Public surface of @notifications/vue. Host apps import the components + the provider, wire a
// NotificationConfig (baseUrl + injected user), and import the stylesheet + (optionally) a preset.

// Components
export { default as NotificationProvider } from "./provider/NotificationProvider.vue";
export { default as NotificationBell } from "./components/NotificationBell.vue";
export { default as NotificationPanel } from "./components/NotificationPopover.vue";
export { default as CriticalToastViewport } from "./components/CriticalToastViewport.vue";
export { default as NotificationAdmin } from "./admin/NotificationAdmin.vue";

// Reusable primitives the host may need (the reference LoginView renders FormRenderer)
export { default as FormRenderer } from "./forms/FormRenderer.vue";
export { default as Button } from "./ui/Button.vue";
export { default as Icon } from "./ui/Icon.vue";
export { default as StatePanel } from "./ui/StatePanel.vue";

// Composables (advanced hosts that render their own notification UI)
export {
  useNotifications,
  useFeed,
  useChat,
  useSummary,
  useSettings,
  useToast,
  usePanel,
  useActions,
  useUser,
  useTransport,
} from "./provider/context";

// Types
export type {
  NotificationConfig,
  NotificationUser,
  NotificationsContext,
} from "./provider/context";
export type { Transport, SseClient, SseFactory, SseStatus } from "./transport/types";
export { ApiError, createCookieTransport } from "./transport/cookie-transport";
export { connectSse } from "./transport/sse";
export type { FormSchema, FormField, FormValues } from "./forms/types";
