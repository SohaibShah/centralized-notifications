import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { NOTIFICATIONS_KEY } from "../provider/context";
import { buildTestContext } from "../test/provider-harness";
import type { Transport } from "../transport/types";
import ModulesPanel from "./ModulesPanel.vue";

const getMock = vi.fn();
const patchMock = vi.fn();
const transport = {
  get: getMock,
  post: vi.fn(),
  patch: patchMock,
  del: vi.fn(),
} as unknown as Transport;

const mountPanel = () =>
  mount(ModulesPanel, {
    global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext({ transport }) } },
  });

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
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue(mods);
    patchMock.mockResolvedValue(undefined);
  });

  it("filters to modules emitting the selected priority", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).toContain("Billing");
    await wrapper.get('[data-test="filter-critical"]').trigger("click");
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).not.toContain("Billing"); // billing has 0 critical
  });

  it("toggling a module PATCHes enabled optimistically", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="toggle-dsar"]').trigger("click");
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", { enabled: false });
  });

  it("shows an empty state when there are no modules", async () => {
    getMock.mockResolvedValueOnce([]);
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("No modules configured");
  });

  it("renders the module label as static text (no rename control)", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.find('[data-test="rename-dsar"]').exists()).toBe(false);
  });
});
