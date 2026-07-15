import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import AdminView from "./AdminView.vue";

describe("AdminView", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("switches between the Modules and Features sections", async () => {
    const wrapper = mount(AdminView, {
      global: { stubs: { ModulesPanel: true, FeaturesPanel: true } },
    });
    const buttons = wrapper.findAll("nav button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.attributes("aria-current")).toBe("page"); // Modules default
    expect(buttons[1]?.attributes("aria-current")).toBeUndefined();

    await buttons[1]?.trigger("click");
    expect(buttons[1]?.attributes("aria-current")).toBe("page");
    expect(buttons[0]?.attributes("aria-current")).toBeUndefined();
  });
});
