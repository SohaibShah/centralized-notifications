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
  groupUnread: 2,
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
    const w = mount(StackRow, { props: { entry: entry(), transport: { get } } });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    expect(get).toHaveBeenCalledWith(expect.stringContaining("group=dsr%3A%231042"));
    expect(get).toHaveBeenCalledWith(expect.stringContaining("limit=3"));
    expect(w.find('[data-test="stack-see-all"]').exists()).toBe(true);
  });

  it("emits see-all with the group key", async () => {
    const get = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const w = mount(StackRow, { props: { entry: entry(), transport: { get } } });
    await w.get('[data-test="stack-header"]').trigger("click");
    await w.get('[data-test="stack-see-all"]').trigger("click");
    expect(w.emitted("see-all")?.[0]).toEqual(["dsr:#1042", "DSAR #1042"]);
  });

  it("shows an error state with retry when the peek fetch fails", async () => {
    const get = vi.fn().mockRejectedValue(new Error("network"));
    const w = mount(StackRow, { props: { entry: entry(), transport: { get } } });
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
});
