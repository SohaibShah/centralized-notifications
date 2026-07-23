import { describe, expect, it, vi } from "vitest";
import { createSettingsState } from "./settings";
import type { Transport } from "../transport/types";

const fakeTransport = (over: Partial<Record<keyof Transport, unknown>> = {}): Transport =>
  ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over }) as Transport;

describe("settings state", () => {
  it("defaults every flag to true before load", () => {
    const s = createSettingsState({ transport: fakeTransport() });
    expect(s.flags.aiSummaryEnabled).toBe(true);
    expect(s.loaded.value).toBe(false);
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
    expect(s.loaded.value).toBe(true);
  });
});
