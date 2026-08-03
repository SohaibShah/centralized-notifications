import { describe, expect, it, vi } from "vitest";
import { createPreferencesState } from "./preferences";
import type { Transport } from "../transport/types";

const fakeTransport = (over: Partial<Record<keyof Transport, unknown>> = {}): Transport =>
  ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over }) as Transport;

describe("preferences state", () => {
  it("defaults before load, then loads prefs + rules", async () => {
    const get = vi.fn(async () => ({
      groupingEnabled: false,
      summaryOptOut: true,
      toastMinPriority: "off",
      rules: [{ targetKind: "module", target: "dsr", mutedUntil: null }],
    }));
    const s = createPreferencesState({ transport: fakeTransport({ get }) });
    expect(s.prefs.groupingEnabled).toBe(true); // default
    expect(s.loaded).toBe(false);

    await s.load();
    expect(get).toHaveBeenCalledWith("/notifications/preferences");
    expect(s.prefs.summaryOptOut).toBe(true);
    expect(s.prefs.toastMinPriority).toBe("off");
    expect(s.rules).toHaveLength(1);
    expect(s.loaded).toBe(true);
  });

  it("updatePref is optimistic and rolls back on error", async () => {
    const patch = vi.fn(async () => {
      throw new Error("nope");
    });
    const s = createPreferencesState({ transport: fakeTransport({ patch }) });
    await expect(s.updatePref({ summaryOptOut: true })).rejects.toThrow("nope");
    expect(s.prefs.summaryOptOut).toBe(false); // rolled back
  });

  it("setMute posts to the rule path and reflects the rule locally", async () => {
    const post = vi.fn(async () => undefined);
    const s = createPreferencesState({ transport: fakeTransport({ post }) });
    await s.setMute("module", "dsr", null);
    expect(post).toHaveBeenCalledWith("/notifications/mutes/module/dsr", { until: null });
    expect(s.rules).toContainEqual({ targetKind: "module", target: "dsr", mutedUntil: null });
  });

  it("fires onRulesChanged after a persisted setMute/clearMute, but not on failure", async () => {
    const onRulesChanged = vi.fn();
    const ok = createPreferencesState({
      transport: fakeTransport({
        post: vi.fn(async () => undefined),
        del: vi.fn(async () => undefined),
      }),
      onRulesChanged,
    });
    await ok.setMute("module", "dsr", null);
    expect(onRulesChanged).toHaveBeenCalledTimes(1); // after the POST resolved
    await ok.clearMute("module", "dsr");
    expect(onRulesChanged).toHaveBeenCalledTimes(2);

    const failing = createPreferencesState({
      transport: fakeTransport({
        post: vi.fn(async () => {
          throw new Error("nope");
        }),
      }),
      onRulesChanged,
    });
    await expect(failing.setMute("module", "dsr", null)).rejects.toThrow("nope");
    expect(onRulesChanged).toHaveBeenCalledTimes(2); // not called on a failed write
  });

  it("clearMute deletes and removes the rule; rolls back on error", async () => {
    const del = vi.fn(async () => {
      throw new Error("boom");
    });
    const s = createPreferencesState({ transport: fakeTransport({ del }) });
    // seed a rule via a successful setMute first
    const s2 = createPreferencesState({
      transport: fakeTransport({ post: vi.fn(async () => undefined) }),
    });
    await s2.setMute("category", "marketing", "2099-01-01T00:00:00.000Z");
    expect(s2.rules).toHaveLength(1);

    // now a failing delete on a store that already has the rule
    s.rules.push({ targetKind: "module", target: "dsr", mutedUntil: null });
    await expect(s.clearMute("module", "dsr")).rejects.toThrow("boom");
    expect(s.rules).toHaveLength(1); // rolled back
    expect(del).toHaveBeenCalledWith("/notifications/mutes/module/dsr");
  });
});
