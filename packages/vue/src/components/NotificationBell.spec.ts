import { describe, expect, it } from "vitest";
import NotificationBell from "./NotificationBell.vue";
import { buildTestContext, mountWithProvider } from "../test/provider-harness";

describe("NotificationBell", () => {
  it("shows the unread count as a badge and in the aria-label (from the server counts snapshot)", () => {
    const ctx = buildTestContext();
    ctx.feed.counts = { unread: 2, unreadByPriority: { critical: 1, high: 1, normal: 0, low: 0 } };
    const wrapper = mountWithProvider(NotificationBell, { context: ctx });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-label")).toContain("2 unread");
    expect(trigger.text()).toContain("2");
  });

  it("opens the popover on click and sets aria-expanded", async () => {
    const wrapper = mountWithProvider(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("closes on Escape and returns focus to the bell", async () => {
    const wrapper = mountWithProvider(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("closes when a pointer press lands outside the bell", async () => {
    const wrapper = mountWithProvider(NotificationBell, { attachTo: document.body });
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
    const wrapper = mountWithProvider(NotificationBell, { attachTo: document.body });
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

  it("stays open when a pointer press lands inside a teleported panel overlay (e.g. the filter menu)", async () => {
    // The filter dropdown is teleported to <body>, outside the bell's root. The bell's
    // outside-click handler must treat a click inside such an overlay as "inside" — otherwise
    // clicking a sort radio / filter checkbox closes the whole panel before the change fires.
    const overlay = document.createElement("div");
    overlay.setAttribute("data-notification-overlay", "");
    document.body.appendChild(overlay);
    const wrapper = mountWithProvider(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true); // stayed open
    wrapper.unmount();
    overlay.remove();
  });

  it("reflects a live unread arrival while the popover is closed", async () => {
    const ctx = buildTestContext();
    const feed = ctx.feed;
    const wrapper = mountWithProvider(NotificationBell, { context: ctx });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.text()).not.toContain("1");

    // A live arrival bumps the counts snapshot (onLiveBatch → adjustCount); the badge tracks it.
    feed.counts = { unread: 1, unreadByPriority: { critical: 0, high: 0, normal: 1, low: 0 } };
    await wrapper.vm.$nextTick();

    expect(trigger.text()).toContain("1");
    expect(trigger.attributes("aria-label")).toContain("1 unread");
  });
});
