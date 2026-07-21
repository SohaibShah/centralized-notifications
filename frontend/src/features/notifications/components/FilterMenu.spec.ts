import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import FilterMenu from "./FilterMenu.vue";

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
});
