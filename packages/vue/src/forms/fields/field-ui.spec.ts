import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TextField from "./TextField.vue";
import type { FormField } from "../types";

const field: FormField = { name: "email", label: "Email", type: "text" };

describe("form field ui overrides", () => {
  it("TextField: default input keeps its rounded corners; ui.input can override them", () => {
    const def = mount(TextField, { props: { field } });
    expect(def.get("input").classes()).toContain("rounded-md");

    const over = mount(TextField, { props: { field, ui: { input: "rounded-none" } } });
    expect(over.get("input").classes()).toContain("rounded-none");
    expect(over.get("input").classes()).not.toContain("rounded-md");
  });

  it("TextField: ui.label overrides the label classes", () => {
    const over = mount(TextField, { props: { field, ui: { label: "text-red-500" } } });
    expect(over.get("label").classes()).toContain("text-red-500");
  });
});
