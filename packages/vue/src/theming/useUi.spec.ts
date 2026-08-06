import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { mount } from "@vue/test-utils";
import { NOTIFICATION_UI_KEY, useUi, type NotificationUi } from "./useUi";

const parts = { root: "rounded-md border border-line", icon: "size-5 text-muted" } as const;

function harness(
  globalUi: NotificationUi | undefined,
  instanceUi?: () => Partial<Record<keyof typeof parts, string>>,
) {
  const Child = defineComponent({
    setup() {
      const ui = useUi("bell", parts, instanceUi);
      return () => h("button", { class: ui("root") }, h("i", { class: ui("icon") }));
    },
  });
  const Parent = defineComponent({
    setup() {
      provide(NOTIFICATION_UI_KEY, ref(globalUi));
      return () => h(Child);
    },
  });
  return mount(Parent);
}

describe("useUi", () => {
  it("returns the part default when nothing overrides it", () => {
    const w = harness(undefined);
    expect(w.get("button").classes()).toContain("rounded-md");
    expect(w.get("i").classes()).toContain("text-muted");
  });

  it("provider global overrides the default (later wins via cn)", () => {
    const w = harness({ bell: { root: "rounded-none" } });
    expect(w.get("button").classes()).toContain("rounded-none");
    expect(w.get("button").classes()).not.toContain("rounded-md");
  });

  it("instance ui overrides the provider global", () => {
    const w = harness({ bell: { root: "rounded-none" } }, () => ({ root: "rounded-full" }));
    expect(w.get("button").classes()).toContain("rounded-full");
    expect(w.get("button").classes()).not.toContain("rounded-none");
  });

  it("only overrides the named part; other parts keep defaults", () => {
    const w = harness({ bell: { root: "border-0" } });
    expect(w.get("i").classes()).toContain("text-muted"); // icon untouched
  });
});
