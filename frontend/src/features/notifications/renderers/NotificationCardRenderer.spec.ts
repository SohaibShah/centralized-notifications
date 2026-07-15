import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedNotification } from "@notifications/shared";
import NotificationCardRenderer from "./NotificationCardRenderer.vue";
import { feedItem } from "@/test-support/feedItem";

function withActions(over: Partial<FeedNotification> & { id: string }): FeedNotification {
  return feedItem({
    actions: [{ label: "Open", url: "https://example.com", method: "GET", icon: "external-link" }],
    ...over,
  });
}

describe("NotificationCardRenderer", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows no chevron and no action bar for a notification without actions", () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    expect(wrapper.find('[aria-label="Show actions"]').exists()).toBe(false);
    expect(wrapper.find("button").text()).toContain("Title");
  });

  it("clicking the title button emits open (mark read)", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("expands via the chevron to reveal action buttons with icons, and expanding emits open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    const chevron = wrapper.get('[aria-label="Show actions"]');
    // collapsed: action button not shown
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false);
    await chevron.trigger("click");
    const actions = wrapper.findAll('[data-test="action"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.text()).toContain("Open");
    expect(actions[0]!.find("svg").exists()).toBe(true); // icon rendered
    expect(wrapper.emitted("open")).toHaveLength(1); // expanding marked read
  });

  it("clicking an action emits action and not a second open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    await wrapper.get('[aria-label="Show actions"]').trigger("click");
    await wrapper.get('[data-test="action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("open")).toHaveLength(1); // only the expand-open, not another
  });
});
