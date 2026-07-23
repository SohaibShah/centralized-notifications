import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_DISMISS_MS, createToastState } from "./toast";

function crit(id: string) {
  return { id, title: `Critical ${id}`, module: "DSAR" };
}

describe("toast state", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enqueues criticals and auto-dismisses after the timeout", () => {
    const t = createToastState();
    t.pushCritical([crit("a")]);
    expect(t.visible.value.map((x) => x.id)).toEqual(["a"]);
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible.value).toEqual([]);
  });

  it("never re-enqueues an id it has already seen", () => {
    const t = createToastState();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    t.pushCritical([crit("a")]); // same id again
    expect(t.visible.value).toEqual([]);
  });

  it("caps visible at 3 and reports the overflow count", () => {
    const t = createToastState();
    t.pushCritical([crit("a"), crit("b"), crit("c"), crit("d")]);
    expect(t.visible.value.map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(t.overflowCount.value).toBe(1);
  });

  it("pause stops the auto-dismiss; resume restarts it", () => {
    const t = createToastState();
    t.pushCritical([crit("a")]);
    t.pause("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
    expect(t.visible.value.map((x) => x.id)).toEqual(["a"]); // still there
    t.resume("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible.value).toEqual([]);
  });

  it("reset() empties visible, clears overflowCount, and re-enables seen ids", () => {
    const t = createToastState();
    t.pushCritical([crit("a"), crit("b"), crit("c")]);
    expect(t.visible.value.length).toBe(3);
    expect(t.overflowCount.value).toBe(0);
    t.reset();
    expect(t.visible.value).toEqual([]);
    expect(t.overflowCount.value).toBe(0);
    // After reset, pushing the same id enqueues it again (seen was cleared)
    t.pushCritical([crit("a")]);
    expect(t.visible.value.map((x) => x.id)).toEqual(["a"]);
  });

  it("dismiss(id) cancels the pending auto-dismiss timer", () => {
    const t = createToastState();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible.value).toEqual([]);
  });

  it("resume(id) on an already-dismissed id is a no-op", () => {
    const t = createToastState();
    t.pushCritical([crit("a")]);
    t.dismiss("a");
    t.resume("a");
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(t.visible.value).toEqual([]);
  });
});
