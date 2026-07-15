import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import CriticalToast from "./CriticalToast.vue";
import { useToastStore } from "@/stores/toast";

const toast = { id: "a", title: "Critical a", description: "d", module: "DSAR" };

describe("CriticalToast", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("emits view and dismiss from the buttons", async () => {
    const wrapper = mount(CriticalToast, { props: { toast } });
    await wrapper.get('[aria-label="Dismiss notification"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    const viewBtn = wrapper.findAll("button").find((b) => b.text() === "View");
    await viewBtn!.trigger("click");
    expect(wrapper.emitted("view")).toHaveLength(1);
  });

  it("keeps the timer paused while focused even after the pointer leaves", async () => {
    const store = useToastStore();
    const pauseSpy = vi.spyOn(store, "pause");
    const resumeSpy = vi.spyOn(store, "resume");
    const wrapper = mount(CriticalToast, { props: { toast } });

    await wrapper.trigger("mouseenter");
    await wrapper.trigger("focusin");
    expect(pauseSpy).toHaveBeenCalledTimes(1); // one transition into the paused state

    await wrapper.trigger("mouseleave"); // pointer gone, focus stays → must NOT resume
    expect(resumeSpy).not.toHaveBeenCalled();

    await wrapper.trigger("focusout"); // both clear now → resumes exactly once
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });
});
