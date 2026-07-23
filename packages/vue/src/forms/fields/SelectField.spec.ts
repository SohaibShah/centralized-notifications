import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SelectField from "./SelectField.vue";

const field = {
  name: "priority",
  label: "Priority",
  type: "select" as const,
  options: [
    { value: "low", label: "low" },
    { value: "high", label: "high" },
  ],
};

describe("SelectField", () => {
  it("renders one option per config entry", () => {
    const w = mount(SelectField, { props: { field, modelValue: "low" } });
    expect(w.findAll("option")).toHaveLength(2);
  });

  it("emits the selected value", async () => {
    const w = mount(SelectField, { props: { field, modelValue: "low" } });
    await w.get("select").setValue("high");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["high"]);
  });
});
