import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import NotificationPopover from "./NotificationPopover.vue";

describe("NotificationPopover", () => {
  beforeEach(() => setActivePinia(createPinia()));

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
});
