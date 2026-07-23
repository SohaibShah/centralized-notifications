import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { feedItem } from "@/test-support/feedItem";

// markRead (fired by onAction now that firing an action also marks read) hits @/api/client — mock it
// so the test doesn't make a real fetch call and doesn't print the "failed to mark read" warning.
const { postMock } = vi.hoisted(() => ({ postMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: postMock } }));

// The AI-summary store is mocked so the disclosure's states are directly controllable and no real
// fetch happens. Set `summaryState.*` before mounting; `fetchSummary` is a spy.
const { summaryState } = vi.hoisted(() => ({
  summaryState: {
    status: "idle" as "idle" | "loading" | "ready" | "error",
    text: "",
    error: null as string | null,
    fetchSummary: vi.fn(),
    reset: vi.fn(),
  },
}));
vi.mock("@/stores/summary", () => ({ useSummaryStore: () => summaryState }));

const { useFeedStore } = await import("@/stores/feed");
const { useSettingsStore } = await import("@/stores/settings");
const { default: InboxTab } = await import("./InboxTab.vue");

describe("InboxTab", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    summaryState.status = "idle";
    summaryState.text = "";
    summaryState.error = null;
    summaryState.fetchSummary.mockClear();
  });

  it("hides the AI-summary band when the ai_summary feature flag is off", () => {
    const feed = useFeedStore();
    feed.status = "ready";
    useSettingsStore().flags.aiSummaryEnabled = false;
    const wrapper = mount(InboxTab);
    expect(wrapper.find('[aria-controls="ai-summary-detail"]').exists()).toBe(false);
  });

  it("shows the AI-summary band when the ai_summary feature flag is on (default)", () => {
    const feed = useFeedStore();
    feed.status = "ready";
    const wrapper = mount(InboxTab);
    expect(wrapper.find('[aria-controls="ai-summary-detail"]').exists()).toBe(true);
  });

  it("renders the caught-up empty state when the feed is ready with no items", () => {
    const feed = useFeedStore();
    feed.status = "ready";
    const wrapper = mount(InboxTab);
    expect(wrapper.text()).toContain("You're all caught up");
  });

  it("renders the filtered-empty state when active filters hide every item", () => {
    const feed = useFeedStore();
    feed.items = [feedItem({ id: "a", priority: "normal" })];
    feed.status = "ready";
    feed.togglePriority("critical");
    const wrapper = mount(InboxTab);
    expect(feed.groups).toHaveLength(0);
    expect(wrapper.text()).toContain("No notifications match your filters");
  });

  it("opens a new tab for a link action", async () => {
    const feed = useFeedStore();
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
    const wrapper = mount(InboxTab);
    await wrapper.get("h3 button").trigger("click");
    const actionButton = wrapper.findAll("button").find((btn) => btn.text().trim() === "Open");
    await actionButton!.trigger("click");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(postMock).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("does not open a tab for a dispatch action but still marks read", async () => {
    const feed = useFeedStore();
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
    const wrapper = mount(InboxTab);
    await wrapper.get("h3 button").trigger("click");
    const btn = wrapper.findAll("button").find((b) => b.text().trim() === "Approve");
    await btn!.trigger("click");
    expect(openSpy).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledWith("/notifications/a/read");
  });

  it("treats a legacy action with no kind as a link (still opens a tab)", async () => {
    const feed = useFeedStore();
    feed.items = [
      feedItem({
        id: "a",
        read: false,
        actions: [{ label: "Open", method: "GET", url: "https://example.com" } as never],
      }),
    ];
    feed.status = "ready";
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mount(InboxTab);
    await wrapper.get("h3 button").trigger("click");
    const btn = wrapper.findAll("button").find((b) => b.text().trim() === "Open");
    await btn!.trigger("click");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("renders the AI summary with a decorative glow and gradient label", () => {
    const wrapper = mount(InboxTab);
    expect(wrapper.find('[data-test="ai-glow"]').exists()).toBe(true);
    const label = wrapper.find('[data-test="ai-summary-label"]');
    expect(label.exists()).toBe(true);
    expect(label.classes()).toContain("text-ai");
  });

  it("no longer renders a sort select in the chips row (moved to the filter menu)", () => {
    const feed = useFeedStore();
    feed.status = "ready";
    const wrapper = mount(InboxTab);
    expect(wrapper.find('[data-test="feed-sort"]').exists()).toBe(false);
  });

  it("shows unread counts on the chips from feed.counts", () => {
    const feed = useFeedStore();
    feed.status = "ready";
    feed.counts = { unread: 5, unreadByPriority: { critical: 2, high: 3, normal: 0, low: 0 } };
    const wrapper = mount(InboxTab);
    expect(wrapper.get('[data-test="chip-count-critical"]').text()).toBe("2");
    expect(wrapper.get('[data-test="chip-count-high"]').text()).toBe("3");
  });

  it("expands the disclosure and lazily fetches the summary on first open", async () => {
    const wrapper = mount(InboxTab);
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(false); // collapsed
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(true); // expands
    expect(summaryState.fetchSummary).toHaveBeenCalledTimes(1); // lazy fetch on open
    expect(wrapper.get('[data-test="ai-glow"]').classes()).toContain("is-blooming"); // bloom fired
  });

  it("does NOT drop the 'Sample' badge — it's real now (label only)", () => {
    const wrapper = mount(InboxTab);
    expect(wrapper.text()).not.toContain("Sample");
  });

  it("shows a loading shimmer while the summary is loading", async () => {
    summaryState.status = "loading";
    const wrapper = mount(InboxTab);
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.find('[data-test="ai-summary-loading"]').exists()).toBe(true);
  });

  it("renders the summary text when ready", async () => {
    summaryState.status = "ready";
    summaryState.text = "Two items need action; start with the overdue DSAR.";
    const wrapper = mount(InboxTab);
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    expect(wrapper.get('[data-test="ai-summary-text"]').text()).toContain(
      "start with the overdue DSAR",
    );
  });

  it("shows an error with a Retry that re-fetches", async () => {
    summaryState.status = "error";
    summaryState.error = "summary unavailable";
    const wrapper = mount(InboxTab);
    await wrapper.find('button[aria-controls="ai-summary-detail"]').trigger("click");
    const retry = wrapper.get('[data-test="ai-summary-retry"]');
    await retry.trigger("click");
    expect(summaryState.fetchSummary).toHaveBeenCalledWith(true);
  });
});
