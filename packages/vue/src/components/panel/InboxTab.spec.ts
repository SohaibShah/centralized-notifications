import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import InboxTab from "./InboxTab.vue";
import { feedItem } from "../../test-support/feedItem";
import { buildTestContext, mountWithProvider } from "../../test/provider-harness";
// buildTestContext is used directly by the muted-view toggle test (custom transport).
import type { NotificationsContext } from "../../provider/context";

// The AI-summary slice is overridden with a fake so the disclosure's states are directly
// controllable and no real fetch happens. Set `summaryState.*` before mounting; `fetchStored` and
// `refresh` are spies.
const summaryState = {
  status: "idle" as "idle" | "loading" | "ready" | "empty" | "error",
  summary: "",
  basedOn: 0,
  generatedAt: null as string | null,
  refreshing: false,
  error: null as string | null,
  fetchStored: vi.fn(),
  refresh: vi.fn(),
};

/** A context using the real feed/settings/actions slices, with summary faked. */
function makeCtx(): NotificationsContext {
  return buildTestContext({ summary: summaryState as unknown as NotificationsContext["summary"] });
}

describe("InboxTab", () => {
  beforeEach(() => {
    summaryState.status = "idle";
    summaryState.summary = "";
    summaryState.basedOn = 0;
    summaryState.generatedAt = null;
    summaryState.refreshing = false;
    summaryState.error = null;
    summaryState.fetchStored.mockClear();
    summaryState.refresh.mockClear();
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

  it("renders a low-emphasis muted-view toggle (not pressed) with no banner by default", () => {
    const ctx = makeCtx();
    ctx.feed.status = "ready";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    const toggle = wrapper.find('[data-test="muted-view-toggle"]');
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-pressed")).toBe("false");
    expect(wrapper.find('[data-test="muted-view-banner"]').exists()).toBe(false);
  });

  it("clicking the toggle switches feed.view to muted and shows the banner", async () => {
    // A transport whose feed GETs resolve an empty page, so setView's refetch doesn't error.
    const transport = {
      get: vi.fn(async () => ({ items: [], nextCursor: null })),
      post: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
      del: vi.fn(async () => ({})),
    } as unknown as NotificationsContext["transport"];
    const ctx = buildTestContext({
      transport,
      summary: summaryState as unknown as NotificationsContext["summary"],
    });
    ctx.feed.status = "ready";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.get('[data-test="muted-view-toggle"]').trigger("click");
    expect(ctx.feed.view).toBe("muted");
    expect(wrapper.get('[data-test="muted-view-toggle"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.find('[data-test="muted-view-banner"]').exists()).toBe(true);
  });

  it("renders the 'Nothing muted' empty state in the muted view (not 'all caught up')", () => {
    const ctx = makeCtx();
    ctx.feed.view = "muted";
    ctx.feed.status = "ready"; // no items
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.text()).toContain("Nothing muted");
    expect(wrapper.text()).not.toContain("You're all caught up");
  });

  it("renders stacks when grouping is active (admin + user on) and no filters", async () => {
    const transport = {
      get: vi.fn(async () => ({
        entries: [
          {
            ...feedItem({ id: "g1", title: "DSAR #1042 overdue" }),
            groupKey: "dsr:#1042",
            groupLabel: "DSAR #1042",
            groupTotal: 3,
            topPriority: "high",
          },
        ],
        nextCursor: null,
      })),
      post: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
      del: vi.fn(async () => ({})),
    } as unknown as NotificationsContext["transport"];
    const ctx = buildTestContext({
      transport,
      summary: summaryState as unknown as NotificationsContext["summary"],
    });
    ctx.settings.flags.groupingEnabled = true;
    ctx.preferences.prefs.groupingEnabled = true;
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await flushPromises();
    expect(wrapper.find('[data-test="stack-header"]').exists()).toBe(true);
  });

  it("falls back to the flat feed when the user grouping pref is off", () => {
    const ctx = makeCtx();
    ctx.settings.flags.groupingEnabled = true;
    ctx.preferences.prefs.groupingEnabled = false;
    ctx.feed.status = "ready";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.find('[data-test="stack-header"]').exists()).toBe(false);
  });

  it("keeps grouping on with a priority filter (server-filtered stacks) and sends the filter", async () => {
    const get = vi.fn(async (_url: string) => ({
      entries: [
        {
          ...feedItem({ id: "g1", title: "DSAR #1042 overdue", priority: "critical" }),
          groupKey: "dsr:#1042",
          groupLabel: "DSAR #1042",
          groupTotal: 1,
          topPriority: "critical",
        },
      ],
      nextCursor: null,
    }));
    const transport = {
      get,
      post: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
      del: vi.fn(async () => ({})),
    } as unknown as NotificationsContext["transport"];
    const ctx = buildTestContext({
      transport,
      summary: summaryState as unknown as NotificationsContext["summary"],
    });
    ctx.settings.flags.groupingEnabled = true;
    ctx.preferences.prefs.groupingEnabled = true;
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await flushPromises();
    ctx.feed.togglePriority("critical");
    await flushPromises();
    // Grouping stays on: the (server-filtered) stacks render — not the flat feed.
    expect(wrapper.find('[data-test="stack-header"]').exists()).toBe(true);
    // And the filter reached the grouped query.
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("grouped=true") && u.includes("priority=critical"))).toBe(
      true,
    );
  });

  it("shows the filtered-empty state (not 'all caught up') when a filter hides every group", async () => {
    const transport = {
      get: vi.fn(async (_url: string) => ({ entries: [], nextCursor: null })),
      post: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
      del: vi.fn(async () => ({})),
    } as unknown as NotificationsContext["transport"];
    const ctx = buildTestContext({
      transport,
      summary: summaryState as unknown as NotificationsContext["summary"],
    });
    ctx.settings.flags.groupingEnabled = true;
    ctx.preferences.prefs.groupingEnabled = true;
    ctx.feed.togglePriority("critical"); // grouping stays on; the server returns no matching groups
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await flushPromises();
    expect(wrapper.find('[data-test="stack-header"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("No notifications match your filters");
    expect(wrapper.text()).not.toContain("You're all caught up");
  });

  it("a text search forces the flat feed even when grouping is on", () => {
    const ctx = makeCtx();
    ctx.settings.flags.groupingEnabled = true;
    ctx.preferences.prefs.groupingEnabled = true;
    ctx.feed.query = "dsar"; // search can't apply to grouped aggregates → flat fallback
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    expect(wrapper.find('[data-test="stack-header"]').exists()).toBe(false);
  });

  it("opens a new tab for a link action", async () => {
    const ctx = makeCtx();
    ctx.preferences.prefs.groupingEnabled = false; // flat feed — this tests card action wiring
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

  it("does not open a tab for a dispatch action, and dispatches to its own index-keyed endpoint", async () => {
    const ctx = makeCtx();
    ctx.preferences.prefs.groupingEnabled = false; // flat feed — this tests card action wiring
    const feed = ctx.feed;
    feed.items = [
      feedItem({
        id: "a",
        read: false,
        actions: [{ label: "Approve", kind: "dispatch", method: "POST", path: "/a" }],
      }),
    ];
    feed.status = "ready";
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.get("h3 button").trigger("click");
    const btn = wrapper.findAll("button").find((b) => b.text().trim() === "Approve");
    await btn!.trigger("click");
    expect(openSpy).not.toHaveBeenCalled();
    expect(ctx.transport.post).toHaveBeenCalledWith(
      "/notifications/a/actions/0/dispatch",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("treats a legacy action with no kind as a link (still opens a tab)", async () => {
    const ctx = makeCtx();
    ctx.preferences.prefs.groupingEnabled = false; // flat feed — this tests card action wiring
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

  it("fetches the STORED summary once on first open (does not regenerate)", async () => {
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    const btn = wrapper.find('button[aria-controls="ai-summary-detail"]');
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(false); // collapsed
    await btn.trigger("click"); // open
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(true);
    expect(summaryState.fetchStored).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="ai-glow"]').classes()).toContain("is-blooming");
  });

  it("shows a loading state while the summary is loading", async () => {
    summaryState.status = "loading";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.find('[data-test="ai-summary-loading"]').exists()).toBe(true);
  });

  it("renders the summary text + timestamp + reload when ready", async () => {
    summaryState.status = "ready";
    summaryState.summary = "Two items need action; start with the overdue DSAR.";
    summaryState.basedOn = 2;
    summaryState.generatedAt = "2026-07-31T08:00:00.000Z";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.get('[data-test="ai-summary-text"]').text()).toContain("overdue DSAR");
    expect(wrapper.find('[data-test="ai-summary-timestamp"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-summary-reload"]').exists()).toBe(true);
  });

  it("shows a caught-up state (with timestamp) when basedOn is 0", async () => {
    summaryState.status = "ready";
    summaryState.basedOn = 0;
    summaryState.generatedAt = "2026-07-31T08:00:00.000Z";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.find('[data-test="ai-summary-caughtup"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-summary-timestamp"]').exists()).toBe(true);
  });

  it("shows the empty state with the configured schedule time", async () => {
    summaryState.status = "empty";
    const ctx = makeCtx();
    ctx.settings.summaryTime = "08:00";
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.get('[data-test="ai-summary-empty"]').text()).toContain("08:00");
  });

  it("reload button calls summary.refresh", async () => {
    summaryState.status = "ready";
    summaryState.summary = "digest";
    summaryState.basedOn = 2;
    summaryState.generatedAt = "2026-07-31T08:00:00.000Z";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    await wrapper.get('[data-test="ai-summary-reload"]').trigger("click");
    expect(summaryState.refresh).toHaveBeenCalled();
  });

  it("shows an error with a Retry that calls refresh", async () => {
    summaryState.status = "error";
    summaryState.error = "summary unavailable";
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    await wrapper.get('[data-test="ai-summary-retry"]').trigger("click");
    expect(summaryState.refresh).toHaveBeenCalled();
  });

  it("shows the opted-out prompt (not a summary fetch) when the user opted out", async () => {
    const ctx = makeCtx();
    ctx.preferences.prefs.summaryOptOut = true;
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.get('[data-test="ai-summary-optedout"]').text()).toContain("turned off");
    expect(summaryState.fetchStored).not.toHaveBeenCalled(); // no fetch while opted out
  });

  it("re-enabling the summary from the panel updates the pref and fetches it", async () => {
    const ctx = makeCtx();
    ctx.preferences.prefs.summaryOptOut = true;
    const updatePref = vi.spyOn(ctx.preferences, "updatePref").mockResolvedValue();
    const wrapper = mountWithProvider(InboxTab, { context: ctx });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    await wrapper.get('[data-test="ai-summary-enable"]').trigger("click");
    expect(updatePref).toHaveBeenCalledWith({ summaryOptOut: false });
    expect(summaryState.fetchStored).toHaveBeenCalled();
  });

  it("shows a spinner + 'Generating…' on the first-time Generate button while refreshing", async () => {
    summaryState.status = "empty";
    summaryState.refreshing = true;
    const wrapper = mountWithProvider(InboxTab, { context: makeCtx() });
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    const btn = wrapper.get('[data-test="ai-summary-empty"] [data-test="ai-summary-reload"]');
    expect(btn.text()).toContain("Generating…");
    expect(btn.find(".motion-safe\\:animate-spin").exists()).toBe(true);
  });
});
