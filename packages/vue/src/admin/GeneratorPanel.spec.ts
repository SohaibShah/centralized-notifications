import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ApiError } from "../transport/cookie-transport";
import { NOTIFICATIONS_KEY } from "../provider/context";
import { buildTestContext } from "../test/provider-harness";

const { simulateMock, modulesMock } = vi.hoisted(() => ({
  simulateMock: vi.fn(),
  modulesMock: vi.fn(),
}));
vi.mock("./adminApi", () => ({
  createAdminApi: () => ({ simulate: simulateMock, fetchModuleKeys: modulesMock }),
}));
const { default: GeneratorPanel } = await import("./GeneratorPanel.vue");

const mountPanel = () =>
  mount(GeneratorPanel, {
    global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext() } },
  });

describe("GeneratorPanel", () => {
  beforeEach(() => {
    simulateMock.mockReset();
    modulesMock.mockReset();
    simulateMock.mockResolvedValue({ published: 1, suppressed: 0 });
    modulesMock.mockResolvedValue(["dsr", "assessments"]);
  });

  it("custom submit calls simulate with the mapped custom spec", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.get('input[name="module"]').setValue("dsr");
    await w.get('input[name="title"]').setValue("Hello");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "custom",
        notification: expect.objectContaining({ module: "dsr", title: "Hello" }),
      }),
    );
    expect(w.text()).toContain("Published 1");
  });

  it("a preset click calls simulate with that preset id", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="mode-preset"]').trigger("click");
    await w.get('[data-test="preset-critical-dsr"]').trigger("click");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith({ mode: "preset", preset: "critical-dsr" });
  });

  it("burst submit calls simulate with count and seed", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="mode-burst"]').trigger("click");
    await w.get('input[name="count"]').setValue("8");
    await w.get('input[name="seed"]').setValue("3");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith({ mode: "burst", count: 8, seed: 3 });
  });

  it("surfaces the server's message on a 400 rather than blaming auth", async () => {
    simulateMock.mockReset();
    simulateMock.mockRejectedValueOnce(new ApiError(400, "invalid request body"));
    const w = mountPanel();
    await flushPromises();
    await w.get('input[name="module"]').setValue("dsr");
    await w.get('input[name="title"]').setValue("x");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("invalid request body");
    expect(w.text()).not.toContain("signed in as an admin");
  });

  it("shows an auth message on a 401/403", async () => {
    simulateMock.mockReset();
    simulateMock.mockRejectedValueOnce(new ApiError(403, "admin role required"));
    const w = mountPanel();
    await flushPromises();
    await w.get('input[name="module"]').setValue("dsr");
    await w.get('input[name="title"]').setValue("x");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("signed in as an admin");
  });

  it("drip start publishes on each tick and stop clears the timer", async () => {
    vi.useFakeTimers();
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="mode-drip"]').trigger("click");
    await w.get('input[name="count"]').setValue("2");
    await w.get('input[name="intervalSeconds"]').setValue("1");
    await w.get("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(simulateMock).toHaveBeenCalledWith({ mode: "burst", count: 2 });
    const callsAfterOneTick = simulateMock.mock.calls.length;
    await w.get('[data-test="drip-stop"]').trigger("click");
    await vi.advanceTimersByTimeAsync(3000);
    expect(simulateMock.mock.calls.length).toBe(callsAfterOneTick);
    vi.useRealTimers();
  });
});
