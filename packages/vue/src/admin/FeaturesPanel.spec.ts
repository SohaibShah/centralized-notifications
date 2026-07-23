import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { NOTIFICATIONS_KEY } from "../provider/context";
import { buildTestContext } from "../test/provider-harness";
import type { Transport } from "../transport/types";
import FeaturesPanel from "./FeaturesPanel.vue";

const getMock = vi.fn();
const patchMock = vi.fn();
const transport = {
  get: getMock,
  post: vi.fn(),
  patch: patchMock,
  del: vi.fn(),
} as unknown as Transport;

const mountPanel = () =>
  mount(FeaturesPanel, {
    global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext({ transport }) } },
  });

describe("FeaturesPanel", () => {
  beforeEach(() => {
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
    const wrapper = mountPanel();
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

  it("shows an error state (not a blank panel) when settings fail to load", async () => {
    getMock.mockReset();
    getMock.mockRejectedValueOnce(new Error("network"));
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Couldn't load settings");
    expect(wrapper.find("form").exists()).toBe(false);
  });
});
