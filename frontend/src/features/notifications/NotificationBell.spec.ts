import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedNotification } from "@notifications/shared";
import NotificationBell from "./NotificationBell.vue";
import { useFeedStore } from "@/stores/feed";

function feedItem(over: Partial<FeedNotification> & { id: string }): FeedNotification {
  return {
    module: "mod",
    title: "T",
    description: "",
    priority: "normal",
    snoozable: true,
    audience: { scope: "global" },
    createdAt: "2026-07-01T00:00:00.000000Z",
    read: false,
    ...over,
  };
}

describe("NotificationBell", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows the unread count as a badge and in the aria-label", () => {
    const feed = useFeedStore();
    feed.items = [feedItem({ id: "a" }), feedItem({ id: "b", read: true }), feedItem({ id: "c" })];
    const wrapper = mount(NotificationBell);
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-label")).toContain("2 unread");
    expect(trigger.text()).toContain("2");
  });

  it("opens the popover on click and sets aria-expanded", async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("closes on Escape and returns focus to the bell", async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("closes when a pointer press lands outside the bell", async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
