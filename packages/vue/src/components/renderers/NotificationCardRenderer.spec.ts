import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedNotification } from "@notifications/shared";
import NotificationCardRenderer from "./NotificationCardRenderer.vue";
import { feedItem } from "@/test-support/feedItem";

function withActions(over: Partial<FeedNotification> & { id: string }): FeedNotification {
  return feedItem({
    actions: [
      {
        label: "Open",
        kind: "link",
        url: "https://example.com",
        method: "GET",
        icon: "external-link",
      },
    ],
    ...over,
  });
}

describe("NotificationCardRenderer", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows no action bar for a card without actions, even after a click (still marks read)", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    expect(wrapper.get("h3 button").text()).toContain("Title");
    // Not expandable → no aria-expanded disclosure on the title.
    expect(wrapper.get("h3 button").attributes("aria-expanded")).toBeUndefined();
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false);
    expect(wrapper.emitted("open")).toHaveLength(1); // clicking still marks read
  });

  it("clicking the title button emits open (mark read)", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("clicking the title expands to reveal actions AND marks read (open-and-seen)", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // collapsed
    await wrapper.get("h3 button").trigger("click");
    const actions = wrapper.findAll('[data-test="action"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.text()).toContain("Open");
    expect(actions[0]!.find("svg").exists()).toBe(true); // icon rendered
    expect(wrapper.emitted("open")).toHaveLength(1); // opening marks read
  });

  it("marks an expandable card's title as a disclosure via aria-expanded that flips on open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    const title = wrapper.get("h3 button");
    expect(title.attributes("aria-expanded")).toBe("false");
    await title.trigger("click");
    expect(title.attributes("aria-expanded")).toBe("true");
  });

  it("clicking an action emits action without an extra open beyond the expand", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    await wrapper.get("h3 button").trigger("click"); // expand → open (1)
    await wrapper.get('[data-test="action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("open")).toHaveLength(1); // the action itself did not emit another open
  });

  const LONG = "x".repeat(200);

  it("clicking the title reveals the full body of a long-body card without actions", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a", description: LONG }) },
    });
    const body = wrapper.get('[data-test="card-body"]');
    expect(body.classes()).toContain("truncate"); // collapsed
    await wrapper.get("h3 button").trigger("click");
    expect(body.classes()).not.toContain("truncate"); // expanded reveals full text
  });

  it("expands the title (drops truncate) when the card is opened", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a", title: "x".repeat(120) }) },
    });
    const title = wrapper.get("h3 button");
    expect(title.classes()).toContain("truncate"); // collapsed → ellipsis
    await title.trigger("click");
    expect(title.classes()).not.toContain("truncate"); // expanded → full title
    expect(title.classes()).toContain("break-words");
  });

  it("shows a 'Mark as read' toggle on an unread card that emits open without expanding", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) }, // expandable, unread
    });
    const toggle = wrapper.get('[data-test="read-toggle"]');
    expect(toggle.attributes("aria-label")).toBe("Mark as read");
    await toggle.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("unread")).toBeUndefined();
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // did NOT expand
    expect(wrapper.get("h3 button").attributes("aria-expanded")).toBe("false");
  });

  it("shows a 'Mark as unread' toggle on a read card that emits unread", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "b", read: true }) },
    });
    const toggle = wrapper.get('[data-test="read-toggle"]');
    expect(toggle.attributes("aria-label")).toBe("Mark as unread");
    await toggle.trigger("click");
    expect(wrapper.emitted("unread")).toHaveLength(1);
  });

  it("renders the priority label in its semantic color", () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a", priority: "critical" }) },
    });
    const label = wrapper.get('[data-test="priority-label"]');
    expect(label.text()).toBe("Critical");
    expect(label.classes()).toContain("text-danger");
  });

  it("shows a decorative expand caret on an expandable card, rotating when open", async () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: withActions({ id: "a" }) },
    });
    const caret = wrapper.find('[data-test="expand-caret"]');
    expect(caret.exists()).toBe(true);
    expect(caret.classes()).not.toContain("rotate-180"); // collapsed
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.get('[data-test="expand-caret"]').classes()).toContain("rotate-180");
  });

  it("shows no expand caret on a card with nothing to expand", () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a" }) },
    });
    expect(wrapper.find('[data-test="expand-caret"]').exists()).toBe(false);
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

  it("applies a priority emphasis class to critical and high cards, not to normal/low", () => {
    const critical = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a", priority: "critical" }) },
    });
    expect(critical.get("article").classes()).toContain("prio-critical");
    const high = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "b", priority: "high" }) },
    });
    expect(high.get("article").classes()).toContain("prio-high");
    const normal = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "c", priority: "normal" }) },
    });
    expect(normal.get("article").classes()).not.toContain("prio-critical");
    expect(normal.get("article").classes()).not.toContain("prio-high");
  });

  it("keeps the priority emphasis on a critical card even once it is read", () => {
    const wrapper = mount(NotificationCardRenderer, {
      props: { notification: feedItem({ id: "a", priority: "critical", read: true }) },
    });
    expect(wrapper.get("article").classes()).toContain("prio-critical");
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
