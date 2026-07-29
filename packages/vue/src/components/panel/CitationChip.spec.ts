import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

// A controllable stub of the shared action state so the chip's pending/result feedback can be
// driven per test. Keys mirror `createNotificationActions`: `${id}:${ref}` for per-action state,
// bare `id` for the per-notification lock.
const { runActionSpy, actionState } = vi.hoisted(() => ({
  runActionSpy: vi.fn(),
  actionState: {
    pending: new Set<string>(),
    locked: new Set<string>(),
    results: new Map<string, { ok: boolean; message?: string }>(),
  },
}));
vi.mock("../../provider/context", () => ({
  useActions: () => ({
    runAction: runActionSpy,
    isPending: (id: string, ref: number) => actionState.pending.has(`${id}:${ref}`),
    isLocked: (id: string) => actionState.locked.has(id),
    resultFor: (id: string, ref: number) => actionState.results.get(`${id}:${ref}`),
  }),
}));

const CitationChip = (await import("./CitationChip.vue")).default;

const source = {
  ref: "n1",
  id: "a1",
  title: "Acme DSAR",
  priority: "critical" as const,
  ageMinutes: 10,
  actions: [{ label: "Open", kind: "link" as const, method: "GET" as const, url: "https://x/1" }],
};

const dispatchSource = {
  ...source,
  actions: [
    { label: "Approve", kind: "dispatch" as const, method: "POST" as const, path: "/approve" },
  ],
};

describe("CitationChip", () => {
  beforeEach(() => {
    runActionSpy.mockReset();
    actionState.pending.clear();
    actionState.locked.clear();
    actionState.results.clear();
  });

  it("shows the title and expands to action buttons that call runAction", async () => {
    const wrapper = mount(CitationChip, { props: { source } });
    expect(wrapper.text()).toContain("Acme DSAR");
    expect(wrapper.find('[data-test="chip-action"]').exists()).toBe(false); // collapsed
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    expect(wrapper.text()).toContain("10m old"); // minute-resolution age, not "0h old"
    const btn = wrapper.find('[data-test="chip-action"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(runActionSpy).toHaveBeenCalledWith(source.actions[0], { id: "a1", ref: 0 });
  });

  it("an action-less source expands but shows no buttons", async () => {
    const wrapper = mount(CitationChip, { props: { source: { ...source, actions: [] } } });
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    expect(wrapper.find('[data-test="chip-action"]').exists()).toBe(false);
  });

  it("shows a spinner and disables a dispatch action while it is in flight", async () => {
    actionState.pending.add("a1:0");
    actionState.locked.add("a1");
    const wrapper = mount(CitationChip, { props: { source: dispatchSource } });
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    const btn = wrapper.find('[data-test="chip-action"]');
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.attributes("aria-busy")).toBe("true");
    expect(btn.find("svg").exists()).toBe(true); // spinner
  });

  it("surfaces the dispatch result message inline after the action settles", async () => {
    actionState.results.set("a1:0", { ok: true, message: "Approved" });
    const wrapper = mount(CitationChip, { props: { source: dispatchSource } });
    await wrapper.find('[data-test="chip-toggle"]').trigger("click");
    const result = wrapper.find('[data-test="chip-action-result"]');
    expect(result.exists()).toBe(true);
    expect(result.text()).toBe("Approved");
    expect(result.classes()).toContain("text-success-strong");
  });
});
