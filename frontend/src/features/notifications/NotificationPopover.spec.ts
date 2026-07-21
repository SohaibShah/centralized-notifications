import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import NotificationPopover from "./NotificationPopover.vue";
import { useFeedStore } from "@/stores/feed";

describe("NotificationPopover", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // The panel refreshes counts on open; stub it so mounting doesn't hit the network.
    vi.spyOn(useFeedStore(), "fetchCounts").mockResolvedValue();
  });

  it("flushes this-session reads and refreshes counts when the panel opens", () => {
    const feed = useFeedStore();
    const flush = vi.spyOn(feed, "flushSessionReads");
    mount(NotificationPopover);
    expect(flush).toHaveBeenCalled();
    expect(feed.fetchCounts).toHaveBeenCalled();
  });

  it("styles the Ask AI tab with the AI gradient identity", () => {
    const wrapper = mount(NotificationPopover);
    const askAi = wrapper.find('[data-test="ask-ai-label"]');
    expect(askAi.exists()).toBe(true);
    expect(askAi.classes()).toContain("text-ai"); // solid AA-legible AI teal (not gradient text)
  });

  it("renders the Inbox tab selected by default", () => {
    const wrapper = mount(NotificationPopover);
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.attributes("aria-selected")).toBe("true");
    // Assistant composer is not mounted while Inbox is active.
    expect(wrapper.find('input[aria-label="Ask the assistant (coming soon)"]').exists()).toBe(
      false,
    );
  });

  it("switches to the Assistant tab, which shows an inert (disabled) composer", async () => {
    const wrapper = mount(NotificationPopover);
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    const composer = wrapper.find('input[aria-label="Ask the assistant (coming soon)"]');
    expect(composer.exists()).toBe(true);
    expect(composer.attributes("disabled")).toBeDefined();
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mount(NotificationPopover);
    await wrapper.find('button[aria-label="Close notifications"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("toggles the search field when the search button is clicked", async () => {
    const wrapper = mount(NotificationPopover);
    const searchButton = wrapper.find('button[aria-label="Search notifications"]');
    expect(searchButton.exists()).toBe(true);

    // Search input should not exist initially
    let searchInput = wrapper.find('input[type="search"]');
    expect(searchInput.exists()).toBe(false);

    // Click to open search
    await searchButton.trigger("click");
    searchInput = wrapper.find('input[type="search"]');
    expect(searchInput.exists()).toBe(true);
  });

  it("hides the search button when on the Assistant tab", async () => {
    const wrapper = mount(NotificationPopover);
    const tabs = wrapper.findAll('[role="tab"]');

    // Switch to Assistant tab
    await tabs[1]!.trigger("click");

    // Search button should not exist in Assistant tab
    const searchButton = wrapper.find('button[aria-label="Search notifications"]');
    expect(searchButton.exists()).toBe(false);
  });
});
