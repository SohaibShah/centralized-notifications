import { describe, expect, it, vi } from "vitest";
import { createSettingsState } from "./settings";
import type { Transport } from "../transport/types";

const fakeTransport = (over: Partial<Record<keyof Transport, unknown>> = {}): Transport =>
  ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over }) as Transport;

describe("settings state", () => {
  it("defaults every flag to true before load", () => {
    const s = createSettingsState({ transport: fakeTransport() });
    expect(s.flags.aiSummaryEnabled).toBe(true);
    expect(s.loaded).toBe(false);
  });

  it("loads flags from GET /settings/features", async () => {
    const get = vi.fn(async () => ({
      aiSummaryEnabled: false,
      chatbotEnabled: true,
      groupingEnabled: true,
      actionsEnabled: true,
    }));
    const s = createSettingsState({ transport: fakeTransport({ get }) });
    await s.load();
    expect(get).toHaveBeenCalledWith("/settings/features");
    expect(s.flags.aiSummaryEnabled).toBe(false);
    expect(s.loaded).toBe(true);
  });

  it("loads summaryTime from GET /settings/features (default '08:00' before load)", async () => {
    const get = vi.fn(async () => ({
      aiSummaryEnabled: true,
      chatbotEnabled: true,
      groupingEnabled: true,
      actionsEnabled: true,
      summaryTime: "06:30",
    }));
    const s = createSettingsState({ transport: fakeTransport({ get }) });
    expect(s.summaryTime).toBe("08:00");
    await s.load();
    expect(s.summaryTime).toBe("06:30");
  });
});
