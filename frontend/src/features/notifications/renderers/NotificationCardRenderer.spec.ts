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

  it("expands via the chevron to reveal action buttons with icons, without marking read", async () => {
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
    expect(wrapper.emitted("open")).toBeFalsy(); // expanding alone does not mark read
  });

  it("clicking an action emits action and not open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    await wrapper.get('[aria-label="Show actions"]').trigger("click");
    await wrapper.get('[data-test="action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("open")).toBeFalsy(); // action-marks-read is InboxTab's job, not the card's
  });

  const LONG = "x".repeat(200);

  it("shows an expand chevron for a long body even without actions, and reveals the full body", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a", description: LONG }) },
    });
    const chevron = wrapper.get('[aria-label="Show details"]');
    const body = wrapper.get('[data-test="card-body"]');
    expect(body.classes()).toContain("truncate"); // collapsed
    await chevron.trigger("click");
    expect(body.classes()).not.toContain("truncate"); // expanded reveals full text
  });

  it("offers Mark as unread only on a read card and emits unread", async () => {
    const unread = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    expect(unread.find('[data-test="mark-unread"]').exists()).toBe(false); // unread item: no control

    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "b", read: true }) },
    });
    await wrapper.get('[data-test="mark-unread"]').trigger("click");
    expect(wrapper.emitted("unread")).toHaveLength(1);
  });
});
