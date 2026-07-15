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
const { default: InboxTab } = await import("./InboxTab.vue");

describe("InboxTab", () => {
  beforeEach(() => setActivePinia(createPinia()));

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

  it("opens a new tab for a GET action surfaced on a card", async () => {
    const feed = useFeedStore();
    feed.items = [
      feedItem({
        id: "a",
        read: false,
        actions: [
          { label: "Open", url: "https://example.com", method: "GET", icon: "external-link" },
        ],
      }),
    ];
    feed.status = "ready";

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const wrapper = mount(InboxTab);
    // Expanding only reveals the action — it must not mark the row read (and thus must
    // not move/remount it) before the action button is clicked.
    await wrapper.get('[aria-label="Show actions"]').trigger("click");
    const actionButton = wrapper.findAll("button").find((btn) => btn.text().trim() === "Open");
    expect(actionButton).toBeTruthy();

    await actionButton!.trigger("click");

    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(postMock).toHaveBeenCalledWith("/notifications/a/read");
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
