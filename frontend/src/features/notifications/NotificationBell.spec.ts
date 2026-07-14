import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import NotificationBell from "./NotificationBell.vue";
import { useFeedStore } from "@/stores/feed";
import { feedItem } from "@/test-support/feedItem";

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

  it("does not steal focus back to the bell when closed by an outside pointer press", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    outside.focus();
    expect(document.activeElement).toBe(outside);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(outside); // focus NOT yanked to the bell
    wrapper.unmount();
    outside.remove();
  });

  it("reflects a live unread arrival while the popover is closed", async () => {
    const feed = useFeedStore();
    const wrapper = mount(NotificationBell);
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.text()).not.toContain("1");

    // Simulate an SSE-delivered item landing in the store (popover never opened).
    feed.items = [feedItem({ id: "live-1" })];
    await wrapper.vm.$nextTick();

    expect(trigger.text()).toContain("1");
    expect(trigger.attributes("aria-label")).toContain("1 unread");
  });
});
