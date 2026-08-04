import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { GroupedEntry } from "@notifications/shared";
import StackRow from "./StackRow.vue";
import { feedItem } from "../../test-support/feedItem";

const entry = (over: Partial<GroupedEntry> = {}): GroupedEntry => ({
  ...feedItem({ id: "g1", title: "DSAR #1042 overdue" }),
  groupKey: "dsr:#1042",
  groupLabel: "DSAR #1042",
  groupTotal: 4,
  topPriority: "high",
  ...over,
});

describe("StackRow", () => {
  it("renders a collapsed header with label + total for a multi-member group", () => {
    const w = mount(StackRow, { props: { entry: entry(), transport: { get: vi.fn() } } });
    expect(w.get('[data-test="stack-header"]').text()).toContain("DSAR #1042");
    expect(w.get('[data-test="stack-header"]').text()).toContain("4");
    expect(w.find('[data-test="stack-peek"]').exists()).toBe(false);
  });

  it("expands to a peek (fetched via ?group&limit=3) and shows See all", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [feedItem({ id: "m1" }), feedItem({ id: "m2" }), feedItem({ id: "m3" })],
      nextCursor: "c",
    });
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    expect(get).toHaveBeenCalledWith(expect.stringContaining("group=dsr%3A%231042"));
    expect(get).toHaveBeenCalledWith(expect.stringContaining("limit=3"));
    expect(w.find('[data-test="stack-see-all"]').exists()).toBe(true);
  });

  it("renders peek members through NotificationCardRenderer (inline actions)", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [feedItem({ id: "m1", title: "M one" }), feedItem({ id: "m2", title: "M two" })],
      nextCursor: null,
    });
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: {
        stubs: { NotificationCardRenderer: { template: '<div data-test="member-card" />' } },
      },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    expect(w.findAll('[data-test="member-card"]').length).toBe(2);
  });

  it("marking a peek member read optimistically flips it in the peek and emits open", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [feedItem({ id: "m1", read: false })],
      nextCursor: null,
    });
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: {
        stubs: {
          NotificationCardRenderer: {
            props: ["notification"],
            emits: ["open", "action", "unread"],
            template: `<button class="mem" :data-read="String(notification.read)" @click="$emit('open', notification)" />`,
          },
        },
      },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    expect(w.get(".mem").attributes("data-read")).toBe("false");
    await w.get(".mem").trigger("click");
    expect(w.emitted("open")).toBeTruthy();
    await Promise.resolve();
    expect(w.get(".mem").attributes("data-read")).toBe("true");
  });

  it("a single-entry card forwards unread", async () => {
    const w = mount(StackRow, {
      props: {
        entry: entry({ groupTotal: 1, groupKey: undefined, read: true }),
        transport: { get: vi.fn() },
      },
      global: {
        stubs: {
          NotificationCardRenderer: {
            props: ["notification"],
            emits: ["open", "action", "unread"],
            template: `<button data-test="single" @click="$emit('unread', notification)" />`,
          },
        },
      },
    });
    await w.get('[data-test="single"]').trigger("click");
    expect(w.emitted("unread")).toBeTruthy();
  });

  it("emits see-all with the group key", async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await w.get('[data-test="stack-see-all"]').trigger("click");
    expect(w.emitted("see-all")?.[0]).toEqual(["dsr:#1042", "DSAR #1042", false]);
  });

  it("emits mark-all-read with the group key from an unread stack", async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const w = mount(StackRow, {
      props: { entry: entry({ read: false }), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await w.get('[data-test="stack-mark-all"]').trigger("click");
    expect(w.emitted("mark-all-read")?.[0]).toEqual(["dsr:#1042"]);
  });

  it("shows an error state with retry when the peek fetch fails", async () => {
    const get = vi.fn().mockRejectedValue(new Error("network"));
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    await Promise.resolve();
    expect(w.find('[data-test="stack-peek-error"]').exists()).toBe(true);
    // Retry re-fetches.
    get.mockResolvedValueOnce({ items: [feedItem({ id: "m1" })], nextCursor: null });
    await w.get('[data-test="stack-peek-error"] button').trigger("click");
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("renders a plain card (no stack chrome) when groupTotal is 1", () => {
    const w = mount(StackRow, {
      props: { entry: entry({ groupTotal: 1, groupKey: undefined }), transport: { get: vi.fn() } },
      // The card renderer pulls from provider context; stub it — we only assert the stack chrome is gone.
      global: { stubs: { NotificationCardRenderer: true } },
    });
    expect(w.find('[data-test="stack-header"]').exists()).toBe(false);
  });

  it("a single notification WITH a groupKey offers 'See all' (jump to the full thread)", async () => {
    const w = mount(StackRow, {
      props: { entry: entry({ groupTotal: 1 }), transport: { get: vi.fn() } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    const seeAll = w.find('[data-test="single-see-all"]');
    expect(seeAll.exists()).toBe(true);
    await seeAll.trigger("click");
    expect(w.emitted("see-all")?.[0]).toEqual(["dsr:#1042", "DSAR #1042", false]);
  });

  it("a truly standalone notification (no groupKey) has no 'See all'", () => {
    const w = mount(StackRow, {
      props: { entry: entry({ groupTotal: 1, groupKey: undefined }), transport: { get: vi.fn() } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    expect(w.find('[data-test="single-see-all"]').exists()).toBe(false);
  });

  it("header reads as a plain notification: group glyph + priority wash, and NO stack-lines", () => {
    const w = mount(StackRow, {
      props: { entry: entry({ topPriority: "critical" }), transport: { get: vi.fn() } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    const header = w.get('[data-test="stack-header"]');
    // Priority is the wash; the header carries no thread/priority line.
    expect(header.classes()).toContain("nt-wash-critical");
    expect(header.classes()).not.toContain("nt-prio-line");
    expect(header.classes()).not.toContain("nt-thread");
    // Collapsed: the thread only appears once the members open.
    expect(w.find(".nt-thread").exists()).toBe(false);
    // The group glyph sits where a card's read-circle would.
    expect(header.find('[data-test="stack-glyph"]').exists()).toBe(true);
  });

  it("a normal-topped header has no wash (falls back to the sunken hover utility)", () => {
    const w = mount(StackRow, {
      props: { entry: entry({ topPriority: "normal" }), transport: { get: vi.fn() } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    const header = w.get('[data-test="stack-header"]');
    expect(header.classes()).not.toContain("nt-wash-critical");
    expect(header.classes()).toContain("hover:bg-sunken/50");
  });

  it("expanded footer is a plain control row with no thread/priority lines", async () => {
    const get = vi.fn().mockResolvedValue({ items: [feedItem({ id: "m1" })], nextCursor: null });
    const w = mount(StackRow, {
      props: { entry: entry({ read: false }), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    const footer = w.get('[data-test="stack-footer"]');
    expect(footer.classes()).not.toContain("nt-thread");
    expect(footer.classes()).not.toContain("nt-prio-line");
    // The footer lives OUTSIDE the threaded region.
    expect(w.get(".nt-thread").find('[data-test="stack-footer"]').exists()).toBe(false);
  });

  it("threads the members with two neutral lines and a per-member priority wash", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [
        feedItem({ id: "m1", priority: "critical" }),
        feedItem({ id: "m2", priority: "normal" }),
      ],
      nextCursor: null,
    });
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    // The open members region carries the outer neutral thread.
    expect(w.get('[data-test="stack-peek"]').classes()).toContain("nt-thread");
    // Both members sit on the inner neutral line; priority is the wash (critical → red flush).
    expect(w.findAll('[data-test="stack-peek"] .nt-prio-line').length).toBe(2);
    expect(w.find('[data-test="stack-peek"] .nt-wash-critical').exists()).toBe(true);
  });

  it("mark-all optimistically flips every loaded peek member read (and emits the key)", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [feedItem({ id: "m1", read: false }), feedItem({ id: "m2", read: false })],
      nextCursor: null,
    });
    const w = mount(StackRow, {
      props: { entry: entry({ read: false }), transport: { get } },
      global: {
        stubs: {
          NotificationCardRenderer: {
            props: ["notification"],
            template: `<div class="mem" :data-read="String(notification.read)" />`,
          },
        },
      },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    expect(w.findAll(".mem").every((m) => m.attributes("data-read") === "false")).toBe(true);
    await w.get('[data-test="stack-mark-all"]').trigger("click");
    expect(w.emitted("mark-all-read")?.[0]).toEqual(["dsr:#1042"]);
    await Promise.resolve();
    expect(w.findAll(".mem").every((m) => m.attributes("data-read") === "true")).toBe(true);
  });
});
