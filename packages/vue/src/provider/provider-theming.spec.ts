import { describe, expect, it } from "vitest";
import { defineComponent, h, inject, ref, type Component } from "vue";
import { mount } from "@vue/test-utils";
import { NOTIFICATION_UI_KEY } from "../theming/useUi";
import { NOTIFICATION_ICONS_KEY } from "../theming/icons";
import NotificationProvider from "./NotificationProvider.vue";

// A probe child that reports what the provider provided.
const Probe = defineComponent({
  setup() {
    const ui = inject(NOTIFICATION_UI_KEY, ref(undefined));
    const icons = inject(NOTIFICATION_ICONS_KEY, ref<Record<string, Component | false>>({}));
    return () =>
      h("div", {
        "data-accent": JSON.stringify(ui.value?.bell?.root ?? null),
        "data-bell-hidden": String(icons.value.bell === false),
        "data-check-present": String(icons.value.check !== undefined),
      });
  },
});

const config = { user: null, baseUrl: "" };

describe("NotificationProvider theming props", () => {
  it("provides the global ui map to descendants", () => {
    const w = mount(NotificationProvider, {
      props: { config, ui: { bell: { root: "rounded-none" } } },
      slots: { default: () => h(Probe) },
    });
    expect(w.get("[data-accent]").attributes("data-accent")).toBe(JSON.stringify("rounded-none"));
  });

  it("merges :icons over the defaults (false hides, defaults still present)", () => {
    const w = mount(NotificationProvider, {
      props: { config, icons: { bell: false } },
      slots: { default: () => h(Probe) },
    });
    expect(w.get("[data-bell-hidden]").attributes("data-bell-hidden")).toBe("true");
    // A name the host didn't override still resolves to its default component.
    expect(w.get("[data-check-present]").attributes("data-check-present")).toBe("true");
  });
});
