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

  it("a dynamic/state class passed as `extra` is beaten by an instance override (merged, not appended)", () => {
    // The state class must go THROUGH the merge, not after it — otherwise a host override that
    // touches the same property would leave both un-deduped and lose on source order.
    const Child = defineComponent({
      setup() {
        // Component renders its own state class (e.g. an active `rounded-xl`) via `extra`.
        const ui = useUi("bell", parts, () => ({ root: "rounded-none" }));
        return () => h("button", { class: ui("root", "rounded-xl") });
      },
    });
    const w = mount(Child);
    expect(w.get("button").classes()).toContain("rounded-none"); // instance override wins
    expect(w.get("button").classes()).not.toContain("rounded-xl");
    expect(w.get("button").classes()).not.toContain("rounded-md"); // and beats the default too
  });
});
