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

  it("expands via the chevron to reveal actions AND marks read (open-and-seen)", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    const chevron = wrapper.get('[aria-label="Show actions"]');
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // collapsed
    await chevron.trigger("click");
    const actions = wrapper.findAll('[data-test="action"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.text()).toContain("Open");
    expect(actions[0]!.find("svg").exists()).toBe(true); // icon rendered
    expect(wrapper.emitted("open")).toHaveLength(1); // opening now marks read
  });

  it("clicking an action emits action without an extra open beyond the expand", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    await wrapper.get('[aria-label="Show actions"]').trigger("click"); // expand → open (1)
    await wrapper.get('[data-test="action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("open")).toHaveLength(1); // the action itself did not emit another open
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

  it("marks an unread card with an inset left accent; a read card has none", () => {
    const unread = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    expect(unread.get("article").classes()).toContain("shadow-[inset_2px_0_0_var(--color-accent)]");
    const read = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "b", read: true }) },
    });
    expect(read.get("article").classes()).not.toContain(
      "shadow-[inset_2px_0_0_var(--color-accent)]",
    );
  });

  it("clicking the card body expands an expandable card and emits open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a", description: LONG }) },
    });
    const body = wrapper.get('[data-test="card-body"]');
    expect(body.classes()).toContain("truncate");
    await wrapper.get("article > div").trigger("click"); // the clickable body row
    expect(body.classes()).not.toContain("truncate");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });
});
