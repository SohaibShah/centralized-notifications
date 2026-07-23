import { defineComponent, h, provide, ref } from "vue";
import { mount, type ComponentMountingOptions } from "@vue/test-utils";
import { vi } from "vitest";
import type { Component } from "vue";
import { NOTIFICATIONS_KEY, type NotificationsContext } from "../provider/context";
import type { Transport } from "../transport/types";
import { createFeedState } from "../state/feed";
import { createChatState } from "../state/chat";
import { createSummaryState } from "../state/summary";
import { createSettingsState } from "../state/settings";
import { createToastState } from "../state/toast";
import { createPanelState } from "../state/panel";
import { createNotificationActions } from "../state/actions";

/** A no-op transport whose methods resolve to `{}` — component specs that exercise a specific slice
 *  override it (see below). */
function stubTransport(): Transport {
  return {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  } as unknown as Transport;
}

/** A real context backed by stub I/O. Pass `over` to replace any slice with a fake carrying canned
 *  data (e.g. `{ feed: { groups: […], markRead: vi.fn(), … } }` cast to the slice type). */
export function buildTestContext(over: Partial<NotificationsContext> = {}): NotificationsContext {
  const transport = over.transport ?? stubTransport();
  const connectSse = () => ({ close: () => {} });
  const toast = createToastState();
  const settings = createSettingsState({ transport });
  const summary = createSummaryState({ transport });
  const feed = createFeedState({ transport, connectSse });
  const chat = createChatState({ baseUrl: "" });
  const actions = createNotificationActions({ feed });
  const panel = createPanelState();
  return {
    feed,
    chat,
    summary,
    settings,
    toast,
    panel,
    actions,
    user: ref(null),
    transport,
    baseUrl: "",
    ...over,
  };
}

/** Mount a component inside a provided notifications context (no `<NotificationProvider>` network). */
export function mountWithProvider(
  component: Component,
  opts: { context?: Partial<NotificationsContext> } & ComponentMountingOptions<unknown> = {},
) {
  const { context, ...mountOpts } = opts;
  const ctx = buildTestContext(context);
  const Wrapper = defineComponent({
    setup(_, { slots }) {
      provide(NOTIFICATIONS_KEY, ctx);
      return () => h("div", { class: "notifications-root" }, slots.default?.());
    },
  });
  return mount(Wrapper, {
    ...(mountOpts as ComponentMountingOptions<unknown>),
    slots: { default: () => h(component) },
  });
}
