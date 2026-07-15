import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { FeedNotification } from "@notifications/shared";
import CriticalToastViewport from "./CriticalToastViewport.vue";
import { useFeedStore } from "@/stores/feed";
import { useToastStore } from "@/stores/toast";
import { useNotificationPanelStore } from "@/stores/notificationPanel";
import { feedItem } from "@/test-support/feedItem";

describe("CriticalToastViewport", () => {
  let fire: ((items: FeedNotification[]) => void) | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    fire = null;
  });
  afterEach(() => vi.useRealTimers());

  function mountWithCapture() {
    const feed = useFeedStore();
    vi.spyOn(feed, "onLiveCritical").mockImplementation((cb) => {
      fire = cb;
      return () => {};
    });
    return mount(CriticalToastViewport);
  }

  it("pushes a critical arrival to the toast store when the panel is closed", () => {
    mountWithCapture();
    const toast = useToastStore();
    fire!([feedItem({ id: "a", priority: "critical" })]);
    expect(toast.visible.map((t) => t.id)).toEqual(["a"]);
  });

  it("suppresses the toast when the panel is already open", () => {
    mountWithCapture();
    const panel = useNotificationPanelStore();
    const toast = useToastStore();
    panel.open();
    fire!([feedItem({ id: "a", priority: "critical" })]);
    expect(toast.visible).toEqual([]);
  });

  it("View opens the panel and dismisses the toast", async () => {
    const wrapper = mountWithCapture();
    const panel = useNotificationPanelStore();
    const toast = useToastStore();
    fire!([feedItem({ id: "a", priority: "critical" })]);
    await nextTick();
    const viewBtn = wrapper.findAll("button").find((b) => b.text() === "View");
    expect(viewBtn).toBeTruthy();
    await viewBtn!.trigger("click");
    expect(panel.isOpen).toBe(true);
    expect(toast.visible).toEqual([]);
  });
});
