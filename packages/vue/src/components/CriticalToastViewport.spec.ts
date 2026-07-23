import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { FeedNotification } from "@notifications/shared";
import CriticalToastViewport from "./CriticalToastViewport.vue";
import { feedItem } from "../test-support/feedItem";
import type { NotificationsContext } from "../provider/context";
import { buildTestContext, mountWithProvider } from "../test/provider-harness";

describe("CriticalToastViewport", () => {
  let fire: ((items: FeedNotification[]) => void) | null = null;
  let ctx: NotificationsContext;

  beforeEach(() => {
    vi.useFakeTimers();
    fire = null;
    ctx = buildTestContext();
  });
  afterEach(() => vi.useRealTimers());

  function mountWithCapture() {
    vi.spyOn(ctx.feed, "onLiveCritical").mockImplementation((cb) => {
      fire = cb;
      return () => {};
    });
    return mountWithProvider(CriticalToastViewport, { context: ctx });
  }

  it("pushes a critical arrival to the toast store when the panel is closed", () => {
    mountWithCapture();
    const toast = ctx.toast;
    fire!([feedItem({ id: "a", priority: "critical" })]);
    expect(toast.visible.map((t) => t.id)).toEqual(["a"]);
  });

  it("suppresses the toast when the panel is already open", () => {
    mountWithCapture();
    const panel = ctx.panel;
    const toast = ctx.toast;
    panel.open();
    fire!([feedItem({ id: "a", priority: "critical" })]);
    expect(toast.visible).toEqual([]);
  });

  it("View opens the panel and dismisses the toast", async () => {
    const wrapper = mountWithCapture();
    const panel = ctx.panel;
    const toast = ctx.toast;
    fire!([feedItem({ id: "a", priority: "critical" })]);
    await nextTick();
    const viewBtn = wrapper.findAll("button").find((b) => b.text() === "View");
    expect(viewBtn).toBeTruthy();
    await viewBtn!.trigger("click");
    expect(panel.isOpen).toBe(true);
    expect(toast.visible).toEqual([]);
  });
});
