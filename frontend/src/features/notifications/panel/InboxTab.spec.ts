import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { feedItem } from "@/test-support/feedItem";

// markRead (fired by onAction now that firing an action also marks read) hits
// @/api/client — mock it so the test doesn't make a real fetch call and doesn't print
// the "failed to mark read; reverted" warning feed.ts logs on a rejected request.
const { postMock } = vi.hoisted(() => ({ postMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/api/client", () => ({ api: { get: vi.fn(), post: postMock } }));

const { useFeedStore } = await import("@/stores/feed");
const { useSettingsStore } = await import("@/stores/settings");
const { default: InboxTab } = await import("./InboxTab.vue");

describe("InboxTab", () => {
  beforeEach(() => setActivePinia(createPinia()));

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

  it("renders the filtered-empty state when active filters hide every item", async () => {
    const feed = useFeedStore();
    feed.items = [feedItem({ id: "a", priority: "normal" })];
    feed.status = "ready";
    feed.togglePriority("critical"); // excludes the only (normal) item

    const wrapper = mount(InboxTab);

    expect(feed.groups).toHaveLength(0);
    expect(feed.items).toHaveLength(1);
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
    // Open the card (title) to reveal its actions. Open-and-seen marks it read, but sticky
    // read keeps it in place (same key → same instance), so the action stays mounted/clickable.
    await wrapper.get("h3 button").trigger("click");
    const actionButton = wrapper.findAll("button").find((btn) => btn.text().trim() === "Open");
    expect(actionButton).toBeTruthy();

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
        // GET method but dispatch kind: proves the UI branches on kind, not the HTTP method
        // (the old method-based code would have opened a GET in a new tab).
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
        // Simulate a row persisted before `kind` existed. The backend now defaults it on read,
        // but the UI guard must not silently drop a link if one ever arrives without kind.
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
    expect(label.classes()).toContain("text-ai"); // solid AA-legible AI teal (not gradient text)
  });

  it("blooms the glow on click (and keeps the existing expand toggle)", async () => {
    const wrapper = mount(InboxTab);
    const btn = wrapper.find('button[aria-controls="ai-summary-detail"]');
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(false); // collapsed
    await btn.trigger("click");
    expect(wrapper.find("#ai-summary-detail").exists()).toBe(true); // still expands
    expect(wrapper.get('[data-test="ai-glow"]').classes()).toContain("is-blooming"); // bloom fired
  });

  it("renders a sort select that calls setSort on change", async () => {
    const feed = useFeedStore();
    feed.status = "ready";
    const spy = vi.spyOn(feed, "setSort").mockResolvedValue();
    const wrapper = mount(InboxTab);
    const select = wrapper.get('[data-test="feed-sort"]');
    await select.setValue("priority-high");
    expect(spy).toHaveBeenCalledWith("priority-high");
  });

  it("toggles the AI-summary detail visibility when the disclosure button is clicked", async () => {
    const wrapper = mount(InboxTab);
    const disclosureButton = wrapper.find('button[aria-controls="ai-summary-detail"]');
    expect(disclosureButton.exists()).toBe(true);

    // Detail should be hidden initially
    const detail = wrapper.find("#ai-summary-detail");
    expect(detail.exists()).toBe(false);

    // Click the disclosure button to open
    await disclosureButton.trigger("click");

    // Detail should now be visible
    const openDetail = wrapper.find("#ai-summary-detail");
    expect(openDetail.exists()).toBe(true);
    expect(openDetail.text()).toContain("2 need action today");
  });
});
