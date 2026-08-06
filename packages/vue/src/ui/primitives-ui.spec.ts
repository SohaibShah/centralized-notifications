import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Button from "./Button.vue";
import Chip from "./Chip.vue";
import StatePanel from "./StatePanel.vue";

describe("primitive ui overrides", () => {
  it("Button: instance ui.root wins over the cva default", () => {
    const def = mount(Button);
    expect(def.get("button").classes()).toContain("rounded-md");

    const over = mount(Button, { props: { ui: { root: "rounded-none" } } });
    expect(over.get("button").classes()).toContain("rounded-none");
    expect(over.get("button").classes()).not.toContain("rounded-md");
  });

  it("Chip: instance ui.root overrides; default unchanged without it", () => {
    const def = mount(Chip);
    expect(def.get("button").classes()).toContain("rounded-full");

    const over = mount(Chip, { props: { ui: { root: "rounded-none" } } });
    expect(over.get("button").classes()).toContain("rounded-none");
    expect(over.get("button").classes()).not.toContain("rounded-full");
  });

  it("StatePanel: instance ui.root applies; renders a string-named icon", () => {
    const w = mount(StatePanel, {
      props: { title: "Nothing here", icon: "bell", ui: { root: "bg-black" } },
    });
    expect(w.get("div").classes()).toContain("bg-black");
    expect(w.find("svg").exists()).toBe(true); // the named icon resolved through the registry default
  });
});
