import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, ref, type Component } from "vue";
import { mount } from "@vue/test-utils";
import Icon from "../ui/Icon.vue";
import { defaultIcons, NOTIFICATION_ICONS_KEY } from "./icons";

const Stub = defineComponent({ name: "StubIcon", render: () => h("svg", { "data-stub": "1" }) });

function withRegistry(registry: Record<string, Component | false>, name: string) {
  const Parent = defineComponent({
    setup() {
      provide(NOTIFICATION_ICONS_KEY, ref(registry));
      return () => h(Icon, { name });
    },
  });
  return mount(Parent);
}

describe("icon registry", () => {
  it("resolves a default icon by name", () => {
    const w = mount(Icon, { props: { name: "bell" } });
    expect(w.findComponent(defaultIcons.bell).exists()).toBe(true);
  });

  it("a provider override swaps the component for that name", () => {
    const w = withRegistry({ ...defaultIcons, bell: Stub }, "bell");
    expect(w.find("[data-stub]").exists()).toBe(true);
  });

  it("name mapped to false renders nothing", () => {
    const w = withRegistry({ ...defaultIcons, bell: false }, "bell");
    expect(w.find("svg").exists()).toBe(false);
  });

  it("an unknown name renders nothing (no broken glyph)", () => {
    const w = mount(Icon, { props: { name: "definitely-not-an-icon" } });
    expect(w.find("svg").exists()).toBe(false);
  });
});
