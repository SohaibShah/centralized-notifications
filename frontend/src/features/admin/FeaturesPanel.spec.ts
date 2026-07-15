import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: getMock, patch: patchMock } }));
const { default: FeaturesPanel } = await import("./FeaturesPanel.vue");

describe("FeaturesPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue({
      aiSummaryEnabled: true,
      chatbotEnabled: false,
      groupingEnabled: true,
      actionsEnabled: true,
    });
    patchMock.mockResolvedValue(undefined);
  });

  it("seeds switches from GET /admin/settings and saves changes via PATCH", async () => {
    const wrapper = mount(FeaturesPanel);
    await flushPromises();
    expect(getMock).toHaveBeenCalledWith("/admin/settings");

    const aiSwitch = wrapper.get('[data-test="switch-aiSummaryEnabled"]');
    expect(aiSwitch.attributes("aria-checked")).toBe("true");
    const chatbotSwitch = wrapper.get('[data-test="switch-chatbotEnabled"]');
    expect(chatbotSwitch.attributes("aria-checked")).toBe("false"); // seeded from server

    await aiSwitch.trigger("click");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(patchMock).toHaveBeenCalledWith(
      "/admin/settings",
      expect.objectContaining({ aiSummaryEnabled: false }),
    );
  });
});
