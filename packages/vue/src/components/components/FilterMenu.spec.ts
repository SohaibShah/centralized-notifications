import { describe, expect, it, vi } from "vitest";
import FilterMenu from "./FilterMenu.vue";
import type { NotificationsContext } from "../../provider/context";
import { buildTestContext, mountWithProvider } from "../../test/provider-harness";

function mountMenu(ctx: NotificationsContext = buildTestContext()) {
  return mountWithProvider(FilterMenu, {
    context: ctx,
    global: { stubs: { teleport: true } },
  });
}

describe("FilterMenu", () => {
  it("teleports the dropdown to the document body when open", async () => {
    const wrapper = mountMenu();
    expect(wrapper.find('[aria-label="Filter notifications"]').exists()).toBe(false); // closed
    await wrapper.get('button[aria-haspopup="true"]').trigger("click");
    const panel = wrapper.find('[aria-label="Filter notifications"]');
    expect(panel.exists()).toBe(true);
    // Teleported: fixed-positioned, not absolute-in-panel.
    expect(panel.attributes("style") ?? "").toContain("position: fixed");
    // Marked so the bell's outside-click handler treats a click inside it as "inside".
    expect(panel.attributes("data-notification-overlay")).toBeDefined();
  });

  it("renders Sort-by radios that reflect feed.sort and call setSort on change", async () => {
    const ctx = buildTestContext();
    const spy = vi.spyOn(ctx.feed, "setSort").mockResolvedValue();
    const wrapper = mountMenu(ctx);
    await wrapper.get('button[aria-haspopup="true"]').trigger("click");
    const newest = wrapper.get('[data-test="feed-sort-newest"]');
    expect((newest.element as HTMLInputElement).checked).toBe(true); // default
    await wrapper.get('[data-test="feed-sort-priority-high"]').setValue();
    expect(spy).toHaveBeenCalledWith("priority-high");
  });
});
