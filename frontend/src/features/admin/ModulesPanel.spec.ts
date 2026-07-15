import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: getMock, patch: patchMock } }));
const { default: ModulesPanel } = await import("./ModulesPanel.vue");

const mods = [
  {
    key: "dsar",
    label: "Dsar",
    enabled: true,
    lastSeenAt: "2026-07-16T00:00:00.000000Z",
    total: 5,
    suppressed: 0,
    byPriority: { critical: 1, high: 2, normal: 2, low: 0 },
  },
  {
    key: "billing",
    label: "Billing",
    enabled: true,
    lastSeenAt: "2026-07-16T00:00:00.000000Z",
    total: 2,
    suppressed: 0,
    byPriority: { critical: 0, high: 0, normal: 2, low: 0 },
  },
];

describe("ModulesPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue(mods);
    patchMock.mockResolvedValue(undefined);
  });

  it("filters to modules emitting the selected priority", async () => {
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).toContain("Billing");
    await wrapper.get('[data-test="filter-critical"]').trigger("click");
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).not.toContain("Billing"); // billing has 0 critical
  });

  it("toggling a module PATCHes enabled optimistically", async () => {
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    await wrapper.get('[data-test="toggle-dsar"]').trigger("click");
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", { enabled: false });
  });

  it("shows an empty state when there are no modules", async () => {
    getMock.mockResolvedValueOnce([]);
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("No modules yet");
  });

  it("renames a label inline on Enter", async () => {
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    await wrapper.get('[data-test="rename-dsar"]').trigger("click");
    const input = wrapper.get('[data-test="rename-input-dsar"]');
    await input.setValue("DSAR (Requests)");
    await input.trigger("keydown.enter");
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", { label: "DSAR (Requests)" });
  });
});
