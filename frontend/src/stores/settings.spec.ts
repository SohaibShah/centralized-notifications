import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: getMock } }));
const { useSettingsStore } = await import("./settings");

describe("settings store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it("defaults every flag to true before load", () => {
    const s = useSettingsStore();
    expect(s.flags.aiSummaryEnabled).toBe(true);
    expect(s.loaded).toBe(false);
  });

  it("loads flags from GET /settings/features", async () => {
    getMock.mockResolvedValueOnce({
      aiSummaryEnabled: false,
      chatbotEnabled: true,
      groupingEnabled: true,
      actionsEnabled: true,
    });
    const s = useSettingsStore();
    await s.load();
    expect(getMock).toHaveBeenCalledWith("/settings/features");
    expect(s.flags.aiSummaryEnabled).toBe(false);
    expect(s.loaded).toBe(true);
  });
});
