import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedNotification, Notification, NotificationCounts } from "@notifications/shared";
import { feedItem } from "../test-support/feedItem";
import { ApiError } from "../transport/cookie-transport";
import { createFeedState } from "./feed";
import type { Transport } from "../transport/types";

// The two I/O seams (HTTP + SSE) are injected as fakes so the state logic is tested in isolation.
const getMock = vi.fn();
const postMock = vi.fn();
const delMock = vi.fn();
const sseState = { onBatch: null as null | ((batch: Notification[]) => void) };

const transport: Transport = {
  get: getMock as unknown as Transport["get"],
  post: postMock as unknown as Transport["post"],
  patch: vi.fn() as unknown as Transport["patch"],
  del: delMock as unknown as Transport["del"],
};
const connectSse = (opts: { onBatch: (batch: Notification[]) => void }) => {
  sseState.onBatch = opts.onBatch;
  return { close: () => {} };
};
const makeFeed = () => createFeedState({ transport, connectSse });

function liveNotif(over: Partial<Notification> & { id: string }): Notification {
  return {
    module: "mod",
    title: "Live",
    description: "",
    priority: "normal",
    snoozable: true,
    audience: { scope: "global" },
    ...over,
  };
}

const page = (items: FeedNotification[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

describe("feed store", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    delMock.mockReset();
    postMock.mockResolvedValue(undefined);
    delMock.mockResolvedValue(undefined);
    sseState.onBatch = null;
  });

  it("load() populates newest page and sets ready + hasMore", async () => {
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" }), feedItem({ id: "b" })], "cur1"));
    const feed = makeFeed();
    await feed.load();
    expect(feed.status).toBe("ready");
    expect(feed.items.map((n) => n.id)).toEqual(["a", "b"]);
    expect(feed.hasMore).toBe(true);
  });

  it("load() sets the error state when the fetch fails", async () => {
    getMock.mockRejectedValueOnce(new Error("network"));
    const feed = makeFeed();
    await feed.load();
    expect(feed.status).toBe("error");
    expect(feed.error).toBeTruthy();
  });

  it("loadMore() appends the next page and de-dupes overlapping ids", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" }), feedItem({ id: "b" })], "cur1"));
    await feed.load();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "b" }), feedItem({ id: "c" })], null));
    await feed.loadMore();
    expect(feed.items.map((n) => n.id)).toEqual(["a", "b", "c"]); // "b" not duplicated
    expect(feed.hasMore).toBe(false);
  });

  it("a live burst prepends new notifications and de-dupes against loaded ones", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" })], null));
    feed.connect();
    await feed.load();
    expect(sseState.onBatch).toBeTypeOf("function");
    sseState.onBatch!([liveNotif({ id: "x" }), liveNotif({ id: "a" })]); // "a" already loaded
    expect(feed.items.map((n) => n.id)).toEqual(["x", "a"]); // "x" prepended, "a" deduped
    expect(feed.items[0]?.read).toBe(false); // live items are unread
  });

  it("filters by priority, module, and free-text query", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(
      page([
        feedItem({ id: "crit", priority: "critical", module: "dsr" }),
        feedItem({ id: "norm", priority: "normal", module: "assessments", title: "hello world" }),
      ]),
    );
    await feed.load();

    feed.togglePriority("critical");
    expect(feed.visibleItems.map((n) => n.id)).toEqual(["crit"]);
    feed.togglePriority("critical"); // clear

    feed.toggleModule("assessments");
    expect(feed.visibleItems.map((n) => n.id)).toEqual(["norm"]);
    feed.toggleModule("assessments"); // clear

    feed.query = "hello";
    expect(feed.visibleItems.map((n) => n.id)).toEqual(["norm"]);
  });

  it("groups into Needs action and Earlier, preserving load order (no client re-sort)", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(
      page([
        feedItem({ id: "n1", priority: "normal", createdAt: "2026-07-01T00:00:00.000000Z" }),
        feedItem({ id: "c1", priority: "critical", createdAt: "2026-07-01T00:00:01.000000Z" }),
        feedItem({ id: "r1", read: true }),
      ]),
    );
    await feed.load();

    const groups = feed.groups;
    expect(groups.map((g) => g.key)).toEqual(["needs-action", "earlier"]);
    // Load order preserved — the server owns the sort now, so the client does NOT re-rank
    // Needs action by priority (n1 loaded before c1 stays n1, c1).
    expect(groups[0]?.items.map((n) => n.id)).toEqual(["n1", "c1"]);
    expect(groups[1]?.items.map((n) => n.id)).toEqual(["r1"]);
  });

  it("setSort clears the loaded window and refetches page 1 with the new sort", async () => {
    getMock.mockResolvedValue(page([feedItem({ id: "a" })], null));
    const feed = makeFeed();
    await feed.load();
    expect(feed.sort).toBe("newest");
    getMock.mockClear();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "z" })], null));
    await feed.setSort("oldest");
    expect(feed.sort).toBe("oldest");
    // load() now also refreshes counts, so a sort change fires the page GET plus a counts GET.
    expect(getMock.mock.calls.some((c) => String(c[0]).includes("sort=oldest"))).toBe(true);
    expect(feed.items.map((n) => n.id)).toEqual(["z"]); // window replaced, not appended
  });

  it("markRead() optimistically flips the flag and POSTs (row stays put — sticky read)", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();

    await feed.markRead("a");

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
    // Open-and-seen: read, but sticky — it stays in Needs action until flushed.
    expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]);
    expect(postMock).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("markRead() keeps the item in Needs action (sticky) until flushed, then moves it to Earlier", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();

    await feed.markRead("a");
    expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
    // Sticky: still grouped under needs-action even though it's read.
    expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]);

    feed.flushSessionReads();
    expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
  });

  it("markAllReadInScope() is NOT sticky — items move to Earlier immediately", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();

    await feed.markAllReadInScope();
    expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
  });

  it("markUnread() clears stickiness so the item is genuinely unread again", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    await feed.markRead("a"); // sticky read
    await feed.markUnread("a");
    expect(feed.items.find((n) => n.id === "a")?.read).toBe(false);
    feed.flushSessionReads();
    // Still unread after a flush (not left stuck as read).
    expect(feed.items.find((n) => n.id === "a")?.read).toBe(false);
    expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]);
  });

  it("markRead() drops a stale notification (404 = deleted server-side) instead of reverting", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    // The notification was deleted server-side (e.g. admin maintenance) while the feed stayed open.
    postMock.mockRejectedValueOnce(new ApiError(404, "notification not found"));

    await feed.markRead("a");

    // Not reverted-and-stuck: the stale row is gone from the feed entirely.
    expect(feed.items.find((n) => n.id === "a")).toBeUndefined();
    expect(feed.groups).toHaveLength(0);
  });

  it("markRead() reverts the flag when the POST fails", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    postMock.mockRejectedValueOnce(new Error("500"));

    await feed.markRead("a");

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(false); // reverted
  });

  it("markRead() failure also clears stickiness (no stale sticky entry left behind)", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    postMock.mockRejectedValueOnce(new Error("500"));

    await feed.markRead("a"); // fails → reverted to unread, un-stuck

    // A subsequent bulk read must land it in Earlier — a lingering sticky id would wrongly pin it.
    postMock.mockResolvedValueOnce(undefined);
    await feed.markAllReadInScope();
    expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
  });

  it("markUnread() failure restores the sticky (in-place) position, not a jump to Earlier", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    await feed.markRead("a"); // sticky read → still in Needs action
    delMock.mockRejectedValueOnce(new Error("500"));

    await feed.markUnread("a"); // fails → reverts to read AND re-sticks

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
    expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]); // not "earlier"
  });

  it("reset() clears the sticky-read set", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    await feed.markRead("a"); // sticky

    feed.reset();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true })]));
    await feed.load();
    // After reset+reload the earlier stickiness is gone: a read item groups to Earlier.
    expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
  });

  it("markRead() is a no-op for an already-read or unknown notification", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true })]));
    await feed.load();

    await feed.markRead("a"); // already read
    await feed.markRead("missing"); // not in the list

    expect(postMock).not.toHaveBeenCalled();
  });

  it("markUnread() optimistically un-reads, moves the row to Needs action, and DELETEs", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true })]));
    await feed.load();

    await feed.markUnread("a");

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(false);
    expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]);
    expect(delMock).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("markUnread() reverts the flag when the DELETE fails", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true })]));
    await feed.load();
    delMock.mockRejectedValueOnce(new Error("500"));

    await feed.markUnread("a");

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(true); // reverted
  });

  it("markUnread() is a no-op for an already-unread or unknown notification", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();

    await feed.markUnread("a"); // already unread
    await feed.markUnread("missing"); // not in the list

    expect(delMock).not.toHaveBeenCalled();
  });

  it("clearFilters() also clears the search query and resets isFiltered", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" })]));
    await feed.load();

    feed.togglePriority("high");
    feed.query = "abc";
    expect(feed.isFiltered).toBe(true);

    feed.clearFilters();
    expect(feed.query).toBe("");
    expect(feed.priorities.size).toBe(0);
    expect(feed.isFiltered).toBe(false);
  });

  it("markAllReadInScope marks only visible unread items and posts their ids", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(
      page([
        feedItem({ id: "a", read: false, priority: "critical" }),
        feedItem({ id: "b", read: true }),
        feedItem({ id: "c", read: false, priority: "normal" }),
      ]),
    );
    await feed.load();
    feed.togglePriority("critical"); // scope now: only "a" is visible+unread

    await feed.markAllReadInScope();

    expect(postMock).toHaveBeenCalledWith("/notifications/read", { ids: ["a"] });
    expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
    expect(feed.items.find((n) => n.id === "c")?.read).toBe(false); // out of scope, untouched
  });

  it("markAllReadInScope reverts all optimistic flips when the POST fails", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" }), feedItem({ id: "b" })]));
    await feed.load();
    postMock.mockRejectedValueOnce(new Error("500"));

    await feed.markAllReadInScope();

    expect(feed.items.every((n) => n.read === false)).toBe(true);
  });

  it("onLiveCritical fires with only newly-arrived critical items", async () => {
    const feed = makeFeed();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "old-crit", priority: "critical" })], null));
    feed.connect();
    await feed.load();

    const seen: string[][] = [];
    const off = feed.onLiveCritical((items) => seen.push(items.map((n) => n.id)));

    sseState.onBatch!([
      liveNotif({ id: "x", priority: "critical" }),
      liveNotif({ id: "y", priority: "normal" }), // not critical → excluded
      liveNotif({ id: "old-crit", priority: "critical" }), // already loaded → excluded
    ]);
    expect(seen).toEqual([["x"]]);

    off();
    sseState.onBatch!([liveNotif({ id: "z", priority: "critical" })]);
    expect(seen).toEqual([["x"]]); // unsubscribed → no further calls
  });

  const counts = (
    unread: number,
    by: Partial<Record<string, number>> = {},
  ): NotificationCounts => ({
    unread,
    unreadByPriority: { critical: 0, high: 0, normal: 0, low: 0, ...by },
  });

  describe("counts", () => {
    it("fetchCounts populates the counts snapshot", async () => {
      getMock.mockResolvedValueOnce(counts(5, { critical: 2, high: 3 }));
      const feed = makeFeed();
      await feed.fetchCounts();
      expect(feed.counts.unread).toBe(5);
      expect(feed.counts.unreadByPriority.critical).toBe(2);
    });

    it("markRead applies an exact optimistic delta by priority", async () => {
      const feed = makeFeed();
      getMock.mockResolvedValueOnce(
        page([feedItem({ id: "a", read: false, priority: "critical" })]),
      );
      await feed.load();
      feed.counts = counts(4, { critical: 2, high: 2 });
      await feed.markRead("a");
      expect(feed.counts.unread).toBe(3);
      expect(feed.counts.unreadByPriority.critical).toBe(1);
    });

    it("markRead reverts the count delta when the POST fails", async () => {
      const feed = makeFeed();
      getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false, priority: "high" })]));
      await feed.load();
      feed.counts = counts(2, { high: 2 });
      postMock.mockRejectedValueOnce(new Error("500"));
      await feed.markRead("a");
      expect(feed.counts.unread).toBe(2);
      expect(feed.counts.unreadByPriority.high).toBe(2);
    });

    it("markUnread increments the count by priority", async () => {
      const feed = makeFeed();
      getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true, priority: "high" })]));
      await feed.load();
      feed.counts = counts(1, { high: 1 });
      await feed.markUnread("a");
      expect(feed.counts.unread).toBe(2);
      expect(feed.counts.unreadByPriority.high).toBe(2);
    });

    it("an SSE batch increments counts for genuinely-new unread items only", async () => {
      const feed = makeFeed();
      getMock.mockResolvedValueOnce(page([feedItem({ id: "a", priority: "critical" })], null));
      feed.connect();
      await feed.load();
      feed.counts = counts(1, { critical: 1 });
      sseState.onBatch!([
        liveNotif({ id: "x", priority: "critical" }),
        liveNotif({ id: "a", priority: "critical" }), // already loaded → not counted
      ]);
      expect(feed.counts.unread).toBe(2);
      expect(feed.counts.unreadByPriority.critical).toBe(2);
    });

    it("markAllReadInScope decrements the count once per flipped id (by priority)", async () => {
      const feed = makeFeed();
      getMock.mockResolvedValueOnce(
        page([
          feedItem({ id: "a", read: false, priority: "critical" }),
          feedItem({ id: "b", read: false, priority: "high" }),
          feedItem({ id: "c", read: true, priority: "high" }), // already read → not flipped
        ]),
      );
      await feed.load();
      feed.counts = counts(4, { critical: 2, high: 2 });
      await feed.markAllReadInScope();
      expect(feed.counts.unread).toBe(2); // -2 (a + b), c untouched
      expect(feed.counts.unreadByPriority.critical).toBe(1);
      expect(feed.counts.unreadByPriority.high).toBe(1);
    });

    it("fetchCounts keeps the last snapshot when the response is malformed", async () => {
      const feed = makeFeed();
      feed.counts = counts(3, { critical: 3 });
      getMock.mockResolvedValueOnce({ unread: 2, unreadByPriority: {} }); // missing buckets
      await feed.fetchCounts();
      // Not poisoned: the prior good snapshot is retained (a partial body would make deltas NaN).
      expect(feed.counts.unread).toBe(3);
      expect(feed.counts.unreadByPriority.critical).toBe(3);
    });

    it("counts never go negative", async () => {
      const feed = makeFeed();
      getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false, priority: "low" })]));
      await feed.load();
      feed.counts = counts(0);
      await feed.markRead("a");
      expect(feed.counts.unread).toBe(0);
      expect(feed.counts.unreadByPriority.low).toBe(0);
    });
  });
});
