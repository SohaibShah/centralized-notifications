import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import NotificationPopover from "./NotificationPopover.vue";
import { NOTIFICATIONS_KEY, type NotificationsContext } from "@/provider/context";
import { buildTestContext } from "@/test/provider-harness";

let ctx: NotificationsContext;
const mountPopover = () =>
  mount(NotificationPopover, { global: { provide: { [NOTIFICATIONS_KEY]: ctx } } });

describe("NotificationPopover", () => {
  beforeEach(() => {
    ctx = buildTestContext();
    // The panel refreshes counts on open; stub it so mounting doesn't hit the network.
    vi.spyOn(ctx.feed, "fetchCounts").mockResolvedValue();
  });

  it("flushes this-session reads and refreshes counts when the panel opens", () => {
    const feed = ctx.feed;
    const flush = vi.spyOn(feed, "flushSessionReads");
    mountPopover();
    expect(flush).toHaveBeenCalled();
    expect(feed.fetchCounts).toHaveBeenCalled();
  });

  it("styles the Ask AI tab with the AI gradient identity", () => {
    const wrapper = mountPopover();
    const askAi = wrapper.find('[data-test="ask-ai-label"]');
    expect(askAi.exists()).toBe(true);
    expect(askAi.classes()).toContain("text-ai"); // solid AA-legible AI teal (not gradient text)
  });

  it("renders the Inbox tab selected by default", () => {
    const wrapper = mountPopover();
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.attributes("aria-selected")).toBe("true");
    // Assistant composer is not mounted while Inbox is active.
    expect(wrapper.find('[data-test="ai-input"]').exists()).toBe(false);
  });

  it("switches to the Assistant tab, which shows the live chat composer", async () => {
    const wrapper = mountPopover();
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    const composer = wrapper.find('[data-test="ai-input"]');
    expect(composer.exists()).toBe(true);
    // The composer is live now (not the old inert stub) — enabled until a request is streaming.
    expect(composer.attributes("disabled")).toBeUndefined();
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mountPopover();
    await wrapper.find('button[aria-label="Close notifications"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("toggles the search field when the search button is clicked", async () => {
    const wrapper = mountPopover();
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
    const wrapper = mountPopover();
    const tabs = wrapper.findAll('[role="tab"]');

    // Switch to Assistant tab
    await tabs[1]!.trigger("click");

    // Search button should not exist in Assistant tab
    const searchButton = wrapper.find('button[aria-label="Search notifications"]');
    expect(searchButton.exists()).toBe(false);
  });
});
