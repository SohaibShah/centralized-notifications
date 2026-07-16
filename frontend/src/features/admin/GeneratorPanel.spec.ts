import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const { simulateMock, modulesMock } = vi.hoisted(() => ({
  simulateMock: vi.fn(),
  modulesMock: vi.fn(),
}));
vi.mock("./adminApi", () => ({ simulate: simulateMock, fetchModuleKeys: modulesMock }));
const { default: GeneratorPanel } = await import("./GeneratorPanel.vue");

describe("GeneratorPanel", () => {
  beforeEach(() => {
    simulateMock.mockReset();
    modulesMock.mockReset();
    simulateMock.mockResolvedValue({ published: 1, suppressed: 0 });
    modulesMock.mockResolvedValue(["dsr", "assessments"]);
  });

  it("custom submit calls simulate with the mapped custom spec", async () => {
    const w = mount(GeneratorPanel);
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
    const w = mount(GeneratorPanel);
    await flushPromises();
    await w.get('[data-test="mode-preset"]').trigger("click");
    await w.get('[data-test="preset-critical-dsr"]').trigger("click");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith({ mode: "preset", preset: "critical-dsr" });
  });

  it("burst submit calls simulate with count and seed", async () => {
    const w = mount(GeneratorPanel);
    await flushPromises();
    await w.get('[data-test="mode-burst"]').trigger("click");
    await w.get('input[name="count"]').setValue("8");
    await w.get('input[name="seed"]').setValue("3");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith({ mode: "burst", count: 8, seed: 3 });
  });

  it("drip start publishes on each tick and stop clears the timer", async () => {
    vi.useFakeTimers();
    const w = mount(GeneratorPanel);
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
