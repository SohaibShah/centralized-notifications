import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { BellOff } from "@lucide/vue";
import FeedBanner from "./FeedBanner.vue";

describe("FeedBanner", () => {
  it("renders label and no exit by default", () => {
    const w = mount(FeedBanner, {
      props: { icon: BellOff, label: "Snoozed & muted notifications" },
    });
    expect(w.get('[data-test="feed-banner"]').text()).toContain("Snoozed & muted");
    expect(w.find('[data-test="feed-banner-exit"]').exists()).toBe(false);
  });
  it("renders an exit button and emits exit on click", async () => {
    const w = mount(FeedBanner, {
      props: { icon: BellOff, label: "DSAR #1042", exitLabel: "Exit group" },
    });
    await w.get('[data-test="feed-banner-exit"]').trigger("click");
    expect(w.emitted("exit")).toBeTruthy();
  });
});
