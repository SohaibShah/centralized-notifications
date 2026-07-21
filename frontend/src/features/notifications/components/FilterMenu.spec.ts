import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import FilterMenu from "./FilterMenu.vue";
import { useFeedStore } from "@/stores/feed";

function mountMenu() {
  return mount(FilterMenu, { global: { stubs: { teleport: true } } });
}

describe("FilterMenu", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("teleports the dropdown to the document body when open", async () => {
    const wrapper = mountMenu();
    expect(wrapper.find('[aria-label="Filter notifications"]').exists()).toBe(false); // closed
    await wrapper.get('button[aria-haspopup="true"]').trigger("click");
    const panel = wrapper.find('[aria-label="Filter notifications"]');
    expect(panel.exists()).toBe(true);
    // Teleported: fixed-positioned, not absolute-in-panel.
    expect(panel.attributes("style") ?? "").toContain("position: fixed");
  });

  it("renders Sort-by radios that reflect feed.sort and call setSort on change", async () => {
    const feed = useFeedStore();
    const spy = vi.spyOn(feed, "setSort").mockResolvedValue();
    const wrapper = mountMenu();
    await wrapper.get('button[aria-haspopup="true"]').trigger("click");
    const newest = wrapper.get('[data-test="feed-sort-newest"]');
    expect((newest.element as HTMLInputElement).checked).toBe(true); // default
    await wrapper.get('[data-test="feed-sort-priority-high"]').setValue();
    expect(spy).toHaveBeenCalledWith("priority-high");
  });
});
