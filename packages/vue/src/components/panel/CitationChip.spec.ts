import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { runActionSpy } = vi.hoisted(() => ({ runActionSpy: vi.fn() }));
vi.mock("@/composables/useNotificationActions", () => ({
  useNotificationActions: () => ({ runAction: runActionSpy }),
}));

const CitationChip = (await import("./CitationChip.vue")).default;

const source = {
  ref: "n1",
  id: "a1",
  title: "Acme DSAR",
  priority: "critical" as const,
  ageMinutes: 10,
  actions: [{ label: "Open", kind: "link" as const, method: "GET" as const, url: "https://x/1" }],
};

describe("CitationChip", () => {
  it("shows the title and expands to action buttons that call runAction", async () => {
    const wrapper = mount(CitationChip, { props: { source } });
    expect(wrapper.text()).toContain("Acme DSAR");
    expect(wrapper.find('[data-test="chip-action"]').exists()).toBe(false); // collapsed
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    expect(wrapper.text()).toContain("10m old"); // minute-resolution age, not "0h old"
    const btn = wrapper.find('[data-test="chip-action"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(runActionSpy).toHaveBeenCalledWith(source.actions[0], { id: "a1" });
  });

  it("an action-less source expands but shows no buttons", async () => {
    const wrapper = mount(CitationChip, { props: { source: { ...source, actions: [] } } });
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    expect(wrapper.find('[data-test="chip-action"]').exists()).toBe(false);
  });
});
