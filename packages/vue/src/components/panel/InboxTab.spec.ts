import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxTab from "./InboxTab.vue";
import { feedItem } from "@/test-support/feedItem";
import { buildTestContext, mountWithProvider } from "@/test/provider-harness";
import type { NotificationsContext } from "@/provider/context";

// The AI-summary slice is overridden with a fake so the disclosure's states are directly
// controllable and no real fetch happens. Set `summaryState.*` before mounting; `fetchSummary`
// is a spy. `reset` is present so the fake matches the slice shape.
const summaryState = {
  status: "idle" as "idle" | "loading" | "ready" | "error",
  text: "",
  error: null as string | null,
  fetchSummary: vi.fn(),
  reset: vi.fn(),
};

/** A context using the real feed/settings/actions slices, with summary faked. The stub transport's
 *  `post` is a vi.fn — markRead (fired by onAction) now goes through the transport, so it's the spy
 *  the read assertions check (replacing the old `@/api/client` mock). */
function makeCtx(): NotificationsContext {
  return buildTestContext({ summary: summaryState as unknown as NotificationsContext["summary"] });
}

describe("InboxTab", () => {
  beforeEach(() => {
    summaryState.status = "idle";
    summaryState.text = "";
    summaryState.error = null;
    summaryState.fetchSummary.mockClear();
  });

  it("hides the AI-summary band when the ai_summary feature flag is off", () => {
    const ctx = makeCtx();
    ctx.feed.status = "ready";
    ctx.settings.flags.aiSummaryEnabled = false;
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.find('[aria-controls="ai-summary-detail"]').exists()).toBe(false);
  });

  it("shows the AI-summary band when the ai_summary feature flag is on (default)", () => {
    const ctx = makeCtx();
    ctx.feed.status = "ready";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.find('[aria-controls="ai-summary-detail"]').exists()).toBe(true);
  });

  it("renders the caught-up empty state when the feed is ready with no items", () => {
    const ctx = makeCtx();
    ctx.feed.status = "ready";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.text()).toContain("You're all caught up");
  });

  it("renders the filtered-empty state when active filters hide every item", () => {
    const ctx = makeCtx();
    const feed = ctx.feed;
    feed.items = [feedItem({ id: "a", priority: "normal" })];
    feed.status = "ready";
    feed.togglePriority("critical");
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(feed.groups).toHaveLength(0);
    expect(wrapper.text()).toContain("No notifications match your filters");
  });

  it("opens a new tab for a link action", async () => {
    const ctx = makeCtx();
    const feed = ctx.feed;
    feed.items = [
      feedItem({
        id: "a",
        read: false,
        actions: [
          {
            label: "Open",
            kind: "link",
            url: "https://example.com",
            method: "GET",
            icon: "external-link",
          },
        ],
      }),
    ];
    feed.status = "ready";
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.get("h3 button").trigger("click");
    const actionButton = wrapper.findAll("button").find((btn) => btn.text().trim() === "Open");
    await actionButton!.trigger("click");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(ctx.transport.post).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("does not open a tab for a dispatch action but still marks read", async () => {
    const ctx = makeCtx();
    const feed = ctx.feed;
    feed.items = [
      feedItem({
        id: "a",
        read: false,
        actions: [
          { label: "Approve", kind: "dispatch", method: "GET", url: "https://example.com/a" },
        ],
      }),
    ];
    feed.status = "ready";
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.get("h3 button").trigger("click");
    const btn = wrapper.findAll("button").find((b) => b.text().trim() === "Approve");
    await btn!.trigger("click");
    expect(openSpy).not.toHaveBeenCalled();
    expect(ctx.transport.post).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("treats a legacy action with no kind as a link (still opens a tab)", async () => {
    const ctx = makeCtx();
    const feed = ctx.feed;
    feed.items = [
      feedItem({
        id: "a",
        read: false,
        actions: [{ label: "Open", method: "GET", url: "https://example.com" } as never],
      }),
    ];
    feed.status = "ready";
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.get("h3 button").trigger("click");
    const btn = wrapper.findAll("button").find((b) => b.text().trim() === "Open");
    await btn!.trigger("click");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("renders the AI summary with a decorative glow and gradient label", () => {
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    expect(wrapper.find('[data-test="ai-glow"]').exists()).toBe(true);
    const label = wrapper.find('[data-test="ai-summary-label"]');
    expect(label.exists()).toBe(true);
    expect(label.classes()).toContain("text-ai");
  });

  it("no longer renders a sort select in the chips row (moved to the filter menu)", () => {
    const ctx = makeCtx();
    ctx.feed.status = "ready";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.find('[data-test="feed-sort"]').exists()).toBe(false);
  });

  it("shows unread counts on the chips from feed.counts", () => {
    const ctx = makeCtx();
    const feed = ctx.feed;
    feed.status = "ready";
    feed.counts = { unread: 5, unreadByPriority: { critical: 2, high: 3, normal: 0, low: 0 } };
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.get('[data-test="chip-count-critical"]').text()).toBe("2");
    expect(wrapper.get('[data-test="chip-count-high"]').text()).toBe("3");
  });

  it("fetches the summary on open, and REFETCHES (force) on every reopen so it can't go stale", async () => {
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    const btn = wrapper.find('button[aria-controls="ai-summary-detail"]');
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(false); // collapsed

    await btn.trigger("click"); // open
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(true);
    expect(summaryState.fetchSummary).toHaveBeenCalledTimes(1);
    expect(summaryState.fetchSummary).toHaveBeenLastCalledWith(true); // force → reflects current set
    expect(wrapper.get('[data-test="ai-glow"]').classes()).toContain("is-blooming");

    await btn.trigger("click"); // close
    await btn.trigger("click"); // reopen → refetch
    expect(summaryState.fetchSummary).toHaveBeenCalledTimes(2);
  });

  it("refreshes the open summary (debounced) when the unread set changes", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeCtx();
      const feed = ctx.feed;
      const wrapper = mountWithProvider(InboxTab, { context: ctx });
      await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click"); // open (1 call)
      summaryState.fetchSummary.mockClear();

      feed.counts = { unread: 25, unreadByPriority: { critical: 0, high: 25, normal: 0, low: 0 } };
      await vi.advanceTimersByTimeAsync(1000); // debounce window
      expect(summaryState.fetchSummary).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT drop the 'Sample' badge — it's real now (label only)", () => {
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    expect(wrapper.text()).not.toContain("Sample");
  });

  it("shows a loading shimmer while the summary is loading", async () => {
    summaryState.status = "loading";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.find('[data-test="ai-summary-loading"]').exists()).toBe(true);
  });

  it("renders the summary text when ready", async () => {
    summaryState.status = "ready";
    summaryState.text = "Two items need action; start with the overdue DSAR.";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.get('[data-test="ai-summary-text"]').text()).toContain(
      "start with the overdue DSAR",
    );
  });

  it("shows an error with a Retry that re-fetches", async () => {
    summaryState.status = "error";
    summaryState.error = "summary unavailable";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    const retry = wrapper.get('[data-test="ai-summary-retry"]');
    await retry.trigger("click");
    expect(summaryState.fetchSummary).toHaveBeenCalledWith(true);
  });
});
