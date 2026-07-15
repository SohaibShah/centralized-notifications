import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { AUTO_DISMISS_MS, useToastStore } from "./toast";

function crit(id: string) {
  return { id, title: `Critical ${id}`, module: "DSAR" };
}

describe("toast store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("enqueues criticals and auto-dismisses after the timeout", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    expect(t.visible.map((x) => x.id)).toEqual(["a"]);
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible).toEqual([]);
  });

  it("never re-enqueues an id it has already seen", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    t.pushCritical([crit("a")]); // same id again
    expect(t.visible).toEqual([]);
  });

  it("caps visible at 3 and reports the overflow count", () => {
    const t = useToastStore();
    t.pushCritical([crit("a"), crit("b"), crit("c"), crit("d")]);
    expect(t.visible.map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(t.overflowCount).toBe(1);
  });

  it("pause stops the auto-dismiss; resume restarts it", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    t.pause("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
    expect(t.visible.map((x) => x.id)).toEqual(["a"]); // still there
    t.resume("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible).toEqual([]);
  });

  it("reset() empties visible, clears overflowCount, and re-enables seen ids", () => {
    const t = useToastStore();
    t.pushCritical([crit("a"), crit("b"), crit("c")]);
    expect(t.visible.length).toBe(3);
    expect(t.overflowCount).toBe(0);
    t.reset();
    expect(t.visible).toEqual([]);
    expect(t.overflowCount).toBe(0);
    // After reset, pushing the same id enqueues it again (seen was cleared)
    t.pushCritical([crit("a")]);
    expect(t.visible.map((x) => x.id)).toEqual(["a"]);
  });

  it("dismiss(id) cancels the pending auto-dismiss timer", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible).toEqual([]);
  });

  it("resume(id) on an already-dismissed id is a no-op", () => {
    const t = useToastStore();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    t.resume("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible).toEqual([]);
  });
});
