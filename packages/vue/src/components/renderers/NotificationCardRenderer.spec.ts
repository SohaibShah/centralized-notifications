import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import NotificationCardRenderer from "./NotificationCardRenderer.vue";
import { feedItem } from "../../test-support/feedItem";
import { NOTIFICATIONS_KEY } from "../../provider/context";
import { buildTestContext } from "../../test/provider-harness";
import type { Transport } from "../../transport/types";

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

const dispatchAction: NotificationAction = {
  label: "Approve",
  kind: "dispatch",
  method: "POST",
  path: "/approve",
};

/** Mount with the real notifications context (settings/actions), overridable via `over`. */
function mountCard(
  notification: FeedNotification,
  over: Parameters<typeof buildTestContext>[0] = {},
) {
  return mount(NotificationCardRenderer, {
    props: { notification },
    global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext(over) } },
  });
}

describe("NotificationCardRenderer", () => {
  it("shows no action bar for a card without actions, even after a click (still marks read)", async () => {
    const wrapper = mountCard(feedItem({ id: "a" }));
    expect(wrapper.get("h3 button").text()).toContain("Title");
    // Not expandable → no aria-expanded disclosure on the title.
    expect(wrapper.get("h3 button").attributes("aria-expanded")).toBeUndefined();
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false);
    expect(wrapper.emitted("open")).toHaveLength(1); // clicking still marks read
  });

  it("clicking the title button emits open (mark read)", async () => {
    const wrapper = mountCard(feedItem({ id: "a" }));
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("clicking the title expands to reveal actions AND marks read (open-and-seen)", async () => {
    const wrapper = mountCard(withActions({ id: "a" }));
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // collapsed
    await wrapper.get("h3 button").trigger("click");
    const actions = wrapper.findAll('[data-test="action"]');
    expect(actions).toHaveLength(1);
    expect(actions[0]!.text()).toContain("Open");
    expect(actions[0]!.find("svg").exists()).toBe(true); // icon rendered
    expect(wrapper.emitted("open")).toHaveLength(1); // opening marks read
  });

  it("marks an expandable card's title as a disclosure via aria-expanded that flips on open", async () => {
    const wrapper = mountCard(withActions({ id: "a" }));
    const title = wrapper.get("h3 button");
    expect(title.attributes("aria-expanded")).toBe("false");
    await title.trigger("click");
    expect(title.attributes("aria-expanded")).toBe("true");
  });

  it("clicking an action emits action without an extra open beyond the expand", async () => {
    const wrapper = mountCard(withActions({ id: "a" }));
    await wrapper.get("h3 button").trigger("click"); // expand → open (1)
    await wrapper.get('[data-test="action"]').trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
    expect(wrapper.emitted("open")).toHaveLength(1); // the action itself did not emit another open
  });

  const LONG = "x".repeat(200);

  it("clicking the title reveals the full body of a long-body card without actions", async () => {
    const wrapper = mountCard(feedItem({ id: "a", description: LONG }));
    const body = wrapper.get('[data-test="card-body"]');
    expect(body.classes()).toContain("truncate"); // collapsed
    await wrapper.get("h3 button").trigger("click");
    expect(body.classes()).not.toContain("truncate"); // expanded reveals full text
  });

  it("expands the title (drops truncate) when the card is opened", async () => {
    const wrapper = mountCard(withActions({ id: "a", title: "x".repeat(120) }));
    const title = wrapper.get("h3 button");
    expect(title.classes()).toContain("truncate"); // collapsed → ellipsis
    await title.trigger("click");
    expect(title.classes()).not.toContain("truncate"); // expanded → full title
    expect(title.classes()).toContain("break-words");
  });

  it("shows a 'Mark as read' toggle on an unread card that emits open without expanding", async () => {
    const wrapper = mountCard(withActions({ id: "a" })); // expandable, unread
    const toggle = wrapper.get('[data-test="read-toggle"]');
    expect(toggle.attributes("aria-label")).toBe("Mark as read");
    await toggle.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("unread")).toBeUndefined();
    expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // did NOT expand
    expect(wrapper.get("h3 button").attributes("aria-expanded")).toBe("false");
  });

  it("shows a 'Mark as unread' toggle on a read card that emits unread", async () => {
    const wrapper = mountCard(feedItem({ id: "b", read: true }));
    const toggle = wrapper.get('[data-test="read-toggle"]');
    expect(toggle.attributes("aria-label")).toBe("Mark as unread");
    await toggle.trigger("click");
    expect(wrapper.emitted("unread")).toHaveLength(1);
  });

  it("renders the priority label in its semantic color", () => {
    const wrapper = mountCard(feedItem({ id: "a", priority: "critical" }));
    const label = wrapper.get('[data-test="priority-label"]');
    expect(label.text()).toBe("Critical");
    expect(label.classes()).toContain("text-danger");
  });

  it("shows a decorative expand caret on an expandable card, rotating when open", async () => {
    const wrapper = mountCard(withActions({ id: "a" }));
    const caret = wrapper.find('[data-test="expand-caret"]');
    expect(caret.exists()).toBe(true);
    expect(caret.classes()).not.toContain("rotate-180"); // collapsed
    await wrapper.get("h3 button").trigger("click");
    expect(wrapper.get('[data-test="expand-caret"]').classes()).toContain("rotate-180");
  });

  it("shows no expand caret on a card with nothing to expand", () => {
    const wrapper = mountCard(feedItem({ id: "a" }));
    expect(wrapper.find('[data-test="expand-caret"]').exists()).toBe(false);
  });

  it("marks an unread card with an inset left accent; a read card has none", () => {
    const unread = mountCard(feedItem({ id: "a" }));
    expect(unread.get("article").classes()).toContain("shadow-[inset_2px_0_0_var(--color-accent)]");
    const read = mountCard(feedItem({ id: "b", read: true }));
    expect(read.get("article").classes()).not.toContain(
      "shadow-[inset_2px_0_0_var(--color-accent)]",
    );
  });

  it("applies a priority emphasis class to critical and high cards, not to normal/low", () => {
    const critical = mountCard(feedItem({ id: "a", priority: "critical" }));
    expect(critical.get("article").classes()).toContain("prio-critical");
    const high = mountCard(feedItem({ id: "b", priority: "high" }));
    expect(high.get("article").classes()).toContain("prio-high");
    const normal = mountCard(feedItem({ id: "c", priority: "normal" }));
    expect(normal.get("article").classes()).not.toContain("prio-critical");
    expect(normal.get("article").classes()).not.toContain("prio-high");
  });

  it("keeps the priority emphasis on a critical card even once it is read", () => {
    const wrapper = mountCard(feedItem({ id: "a", priority: "critical", read: true }));
    expect(wrapper.get("article").classes()).toContain("prio-critical");
  });

  it("clicking the card body expands an expandable card and emits open", async () => {
    const wrapper = mountCard(feedItem({ id: "a", description: LONG }));
    const body = wrapper.get('[data-test="card-body"]');
    expect(body.classes()).toContain("truncate");
    await wrapper.get("article > div").trigger("click"); // the clickable body row
    expect(body.classes()).not.toContain("truncate");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  describe("dispatch action buttons", () => {
    function withDispatch(over: Partial<FeedNotification> & { id: string }): FeedNotification {
      return feedItem({ actions: [dispatchAction], ...over });
    }

    it("renders a dispatch button when actionsEnabled is on (default)", async () => {
      const wrapper = mountCard(withDispatch({ id: "a" }));
      await wrapper.get("h3 button").trigger("click"); // expand
      const actions = wrapper.findAll('[data-test="action"]');
      expect(actions).toHaveLength(1);
      expect(actions[0]!.text()).toContain("Approve");
    });

    it("hides dispatch buttons when actionsEnabled is off, but still renders link actions", async () => {
      const notification = feedItem({
        id: "a",
        actions: [
          dispatchAction,
          { label: "Open", kind: "link", url: "https://example.com", method: "GET" },
        ],
      });
      const ctx = buildTestContext();
      ctx.settings.flags.actionsEnabled = false;
      const wrapper = mount(NotificationCardRenderer, {
        props: { notification },
        global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
      });
      await wrapper.get("h3 button").trigger("click"); // expand
      const actions = wrapper.findAll('[data-test="action"]');
      expect(actions).toHaveLength(1);
      expect(actions[0]!.text()).toContain("Open");
      expect(actions.some((a) => a.text().includes("Approve"))).toBe(false);
    });

    it("shows no expand caret (and no empty expand row) when the only actions are dispatch and actionsEnabled is off", async () => {
      const notification = withDispatch({ id: "a" }); // dispatch is its ONLY action
      const ctx = buildTestContext();
      ctx.settings.flags.actionsEnabled = false;
      const wrapper = mount(NotificationCardRenderer, {
        props: { notification },
        global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
      });
      expect(wrapper.find('[data-test="expand-caret"]').exists()).toBe(false);
      const title = wrapper.get("h3 button");
      expect(title.attributes("aria-expanded")).toBeUndefined();
      await title.trigger("click"); // not expandable — just marks read, nothing to reveal
      expect(wrapper.find('[data-test="action"]').exists()).toBe(false);
      expect(wrapper.emitted("open")).toHaveLength(1);
    });

    it("emits action with the action, the notification, and its index in the actions array", async () => {
      const notification = feedItem({
        id: "a",
        actions: [
          { label: "Open", kind: "link", url: "https://example.com", method: "GET" },
          dispatchAction,
        ],
      });
      const wrapper = mountCard(notification);
      await wrapper.get("h3 button").trigger("click"); // expand
      const actions = wrapper.findAll('[data-test="action"]');
      expect(actions).toHaveLength(2);
      await actions[1]!.trigger("click"); // the 2nd action → index 1
      const emitted = wrapper.emitted("action");
      expect(emitted).toHaveLength(1);
      expect(emitted![0]).toEqual([dispatchAction, notification, 1]);
    });

    it("disables the dispatch button and shows a spinner while its dispatch is pending", async () => {
      const notification = withDispatch({ id: "a" });
      // A never-resolving post keeps this action pending for the life of the assertion.
      const pendingTransport = {
        get: async () => ({}),
        post: () => new Promise(() => {}),
        patch: async () => ({}),
        del: async () => ({}),
      } as unknown as Transport;
      const ctx = buildTestContext({ transport: pendingTransport });
      const wrapper = mount(NotificationCardRenderer, {
        props: { notification },
        global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
      });
      await wrapper.get("h3 button").trigger("click"); // expand
      const btn = wrapper.get('[data-test="action"]');
      expect(btn.attributes("disabled")).toBeUndefined();
      void ctx.actions.runAction(dispatchAction, { id: "a", ref: 0 }); // fire-and-forget: never resolves
      await wrapper.vm.$nextTick();
      expect(wrapper.get('[data-test="action"]').attributes("disabled")).toBeDefined();
      expect(wrapper.get('[data-test="action"]').find("svg").exists()).toBe(true); // spinner
    });

    it("shows the result message inline after a dispatch resolves", async () => {
      const notification = withDispatch({ id: "a" });
      const okTransport = {
        get: async () => ({}),
        post: async () => ({ ok: true, message: "Approved" }),
        patch: async () => ({}),
        del: async () => ({}),
      } as unknown as Transport;
      const ctx = buildTestContext({ transport: okTransport });
      const wrapper = mount(NotificationCardRenderer, {
        props: { notification },
        global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
      });
      await wrapper.get("h3 button").trigger("click"); // expand
      await ctx.actions.runAction(dispatchAction, { id: "a", ref: 0 });
      await wrapper.vm.$nextTick();
      const result = wrapper.get('[data-test="action-result"]');
      expect(result.text()).toBe("Approved");
      expect(result.classes()).toContain("text-success-strong");
    });

    it("locks the sibling dispatch button once one action resolves (can't act twice)", async () => {
      const notification = feedItem({
        id: "a",
        actions: [
          dispatchAction, // Approve
          { label: "Reject", kind: "dispatch", method: "POST", path: "/reject" },
        ],
      });
      const okTransport = {
        get: async () => ({}),
        post: async () => ({ ok: true, message: "Approved", resolve: true }),
        patch: async () => ({}),
        del: async () => ({}),
      } as unknown as Transport;
      const ctx = buildTestContext({ transport: okTransport });
      const wrapper = mount(NotificationCardRenderer, {
        props: { notification },
        global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
      });
      await wrapper.get("h3 button").trigger("click"); // expand
      const before = wrapper.findAll('[data-test="action"]');
      expect(before).toHaveLength(2);
      expect(before.every((b) => b.attributes("disabled") === undefined)).toBe(true);

      await ctx.actions.runAction(dispatchAction, { id: "a", ref: 0 });
      await wrapper.vm.$nextTick();

      // Both the acted action AND its sibling are now disabled — the notification is settled.
      const after = wrapper.findAll('[data-test="action"]');
      expect(after.every((b) => b.attributes("disabled") !== undefined)).toBe(true);
    });
  });
});
