import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CriticalToast from "./CriticalToast.vue";
import type { ToastItem } from "../state/toast";

// CriticalToast needs the toast store (useToast) via provide; mount with a stub inject.
import { NOTIFICATIONS_KEY } from "../provider/context";

const toast: ToastItem = {
  id: "t1",
  title: "Critical thing",
  description: "desc",
  module: "dsr",
  priority: "critical",
};

const ctxStub = {
  toast: { pause: () => {}, resume: () => {} },
} as unknown as Record<string, unknown>;

function mountToast(ui?: Record<string, string>) {
  return mount(CriticalToast, {
    props: { toast, ui },
    global: { provide: { [NOTIFICATIONS_KEY as symbol]: ctxStub } },
  });
}

describe("entry/surface ui overrides", () => {
  it("CriticalToast: default root has a border; ui.root can remove it", () => {
    expect(mountToast().get('[role="alert"]').classes()).toContain("border");
    const over = mountToast({ root: "border-0" });
    expect(over.get('[role="alert"]').classes()).toContain("border-0");
    expect(over.get('[role="alert"]').classes()).not.toContain("border");
  });

  it("CriticalToast: ui.title overrides the title classes", () => {
    const over = mountToast({ title: "text-red-500" });
    expect(over.get('[data-test="toast-title"]').classes()).toContain("text-red-500");
  });
});
