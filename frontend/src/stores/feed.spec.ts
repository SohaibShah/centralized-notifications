import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { FeedNotification, Notification } from "@notifications/shared";
import { feedItem } from "@/test-support/feedItem";

// Mock the two I/O seams (HTTP + SSE) so the store's logic is tested in isolation.
// vi.hoisted lets the mock factories reference these before the imports are evaluated.
const { getMock, postMock, sseState } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  sseState: { onBatch: null as null | ((batch: Notification[]) => void) },
}));

vi.mock("@/api/client", () => ({ api: { get: getMock, post: postMock } }));
vi.mock("@/api/sse", () => ({
  connectSse: (opts: { onBatch: (batch: Notification[]) => void }) => {
    sseState.onBatch = opts.onBatch;
    return { close: () => {} };
  },
}));

// Imported after the mocks are registered.
const { useFeedStore } = await import("./feed");

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
    setActivePinia(createPinia());
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue(undefined);
    sseState.onBatch = null;
  });

  it("load() populates newest page and sets ready + hasMore", async () => {
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" }), feedItem({ id: "b" })], "cur1"));
    const feed = useFeedStore();
    await feed.load();
    expect(feed.status).toBe("ready");
    expect(feed.items.map((n) => n.id)).toEqual(["a", "b"]);
    expect(feed.hasMore).toBe(true);
  });

  it("load() sets the error state when the fetch fails", async () => {
    getMock.mockRejectedValueOnce(new Error("network"));
    const feed = useFeedStore();
    await feed.load();
    expect(feed.status).toBe("error");
    expect(feed.error).toBeTruthy();
  });

  it("loadMore() appends the next page and de-dupes overlapping ids", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" }), feedItem({ id: "b" })], "cur1"));
    await feed.load();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "b" }), feedItem({ id: "c" })], null));
    await feed.loadMore();
    expect(feed.items.map((n) => n.id)).toEqual(["a", "b", "c"]); // "b" not duplicated
    expect(feed.hasMore).toBe(false);
  });

  it("a live burst prepends new notifications and de-dupes against loaded ones", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a" })], null));
    feed.connect();
    await feed.load();
    expect(sseState.onBatch).toBeTypeOf("function");
    sseState.onBatch!([liveNotif({ id: "x" }), liveNotif({ id: "a" })]); // "a" already loaded
    expect(feed.items.map((n) => n.id)).toEqual(["x", "a"]); // "x" prepended, "a" deduped
    expect(feed.items[0]?.read).toBe(false); // live items are unread
  });

  it("filters by priority, module, and free-text query", async () => {
    const feed = useFeedStore();
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

  it("groups into Needs action (unread, urgency-sorted) and Earlier (read)", async () => {
    const feed = useFeedStore();
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
    expect(groups[0]?.items.map((n) => n.id)).toEqual(["c1", "n1"]); // critical before normal
    expect(groups[1]?.items.map((n) => n.id)).toEqual(["r1"]);
    expect(feed.unreadCount).toBe(2);
  });

  it("markRead() optimistically flips the flag, moves the row to Earlier, and POSTs", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    expect(feed.unreadCount).toBe(1);

    await feed.markRead("a");

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
    expect(feed.unreadCount).toBe(0);
    expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
    expect(postMock).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("markRead() reverts the flag when the POST fails", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
    await feed.load();
    postMock.mockRejectedValueOnce(new Error("500"));

    await feed.markRead("a");

    expect(feed.items.find((n) => n.id === "a")?.read).toBe(false); // reverted
    expect(feed.unreadCount).toBe(1);
  });

  it("markRead() is a no-op for an already-read or unknown notification", async () => {
    const feed = useFeedStore();
    getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: true })]));
    await feed.load();

    await feed.markRead("a"); // already read
    await feed.markRead("missing"); // not in the list

    expect(postMock).not.toHaveBeenCalled();
  });

  it("clearFilters() also clears the search query and resets isFiltered", async () => {
    const feed = useFeedStore();
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
});
