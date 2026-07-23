import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import CriticalToast from "./CriticalToast.vue";
import { NOTIFICATIONS_KEY } from "@/provider/context";
import { buildTestContext } from "@/test/provider-harness";

const toast = { id: "a", title: "Critical a", description: "d", module: "DSAR" };

describe("CriticalToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("emits view and dismiss from the buttons", async () => {
    const wrapper = mount(CriticalToast, {
      props: { toast },
      global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext() } },
    });
    await wrapper.get('[aria-label="Dismiss notification"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    const viewBtn = wrapper.findAll("button").find((b) => b.text() === "View");
    await viewBtn!.trigger("click");
    expect(wrapper.emitted("view")).toHaveLength(1);
  });

  it("keeps the timer paused while focused even after the pointer leaves", async () => {
    const ctx = buildTestContext();
    const store = ctx.toast;
    const pauseSpy = vi.spyOn(store, "pause");
    const resumeSpy = vi.spyOn(store, "resume");
    const wrapper = mount(CriticalToast, {
      props: { toast },
      global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
    });

    await wrapper.trigger("mouseenter");
    await wrapper.trigger("focusin");
    expect(pauseSpy).toHaveBeenCalledTimes(1); // one transition into the paused state

    await wrapper.trigger("mouseleave"); // pointer gone, focus stays → must NOT resume
    expect(resumeSpy).not.toHaveBeenCalled();

    await wrapper.trigger("focusout"); // both clear now → resumes exactly once
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });
});
