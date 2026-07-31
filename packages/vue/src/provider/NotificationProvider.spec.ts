import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import NotificationProvider from "./NotificationProvider.vue";
import type { Transport } from "../transport/types";

describe("NotificationProvider", () => {
  it("loads per-user preferences on mount so the toast/grouping prefs are live app-wide", async () => {
    const get = vi.fn(async (path: string) =>
      path === "/notifications/preferences"
        ? { groupingEnabled: true, summaryOptOut: false, toastMinPriority: "off", rules: [] }
        : {},
    );
    const transport = { get, post: vi.fn(), patch: vi.fn(), del: vi.fn() } as unknown as Transport;

    mount(NotificationProvider, {
      props: {
        config: { baseUrl: "", user: null, transport, connectSse: () => ({ close: () => {} }) },
      },
      slots: { default: () => h("div") },
    });
    await flushPromises();

    expect(get).toHaveBeenCalledWith("/notifications/preferences");
  });
});
