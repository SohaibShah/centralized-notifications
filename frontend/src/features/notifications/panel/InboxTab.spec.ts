import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import InboxTab from "./InboxTab.vue";
import { useFeedStore } from "@/stores/feed";
import { feedItem } from "@/test-support/feedItem";

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
        actions: [
          { label: "Open", url: "https://example.com", method: "GET", icon: "external-link" },
        ],
      }),
    ];
    feed.status = "ready";

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const wrapper = mount(InboxTab);
    const actionButton = wrapper.findAll("button").find((btn) => btn.text().trim() === "Open");
    expect(actionButton).toBeTruthy();

    await actionButton!.trigger("click");

    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });
});
