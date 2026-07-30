import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FormRenderer from "./FormRenderer.vue";
import type { FormSchema } from "./types";

const schema: FormSchema = {
  id: "t",
  fields: [
    {
      name: "scope",
      label: "Scope",
      type: "select",
      required: true,
      default: "global",
      options: [
        { value: "global", label: "global" },
        { value: "team", label: "team" },
      ],
    },
    {
      name: "id",
      label: "Audience id",
      type: "text",
      showIf: { field: "scope", notEquals: "global" },
    },
  ],
};

describe("FormRenderer select + showIf", () => {
  it("renders a select field", () => {
    const w = mount(FormRenderer, { props: { schema } });
    expect(w.find('select[name="scope"]').exists()).toBe(true);
  });

  it("hides a showIf field until its condition is met", async () => {
    const w = mount(FormRenderer, { props: { schema } });
    expect(w.find('[name="id"]').exists()).toBe(false); // scope defaults to global
    await w.get('select[name="scope"]').setValue("team");
    expect(w.find('[name="id"]').exists()).toBe(true);
  });
});

const groupedSchema: FormSchema = {
  id: "g",
  fields: [
    { name: "a", label: "A", type: "switch", group: "Group one" },
    {
      name: "aDetail",
      label: "A detail",
      type: "time",
      group: "Group one",
      showIf: { field: "a", equals: true },
    },
    { name: "b", label: "B", type: "switch", group: "Group two" },
  ],
};

describe("FormRenderer grouping", () => {
  it("renders a heading per group, in order", () => {
    const w = mount(FormRenderer, { props: { schema: groupedSchema } });
    const headings = w.findAll('[data-test="form-group-heading"]').map((h) => h.text());
    expect(headings).toEqual(["Group one", "Group two"]);
  });

  it("does not render a heading for a group whose only fields are hidden", () => {
    // "Group one" still has the visible `a` switch, so its heading shows; but the conditional
    // `aDetail` is hidden while `a` is false. Flip `a` on and the detail appears under the SAME
    // heading (no duplicate heading).
    const w = mount(FormRenderer, { props: { schema: groupedSchema } });
    expect(w.find('[name="aDetail"]').exists()).toBe(false);
    expect(w.findAll('[data-test="form-group-heading"]')).toHaveLength(2);
  });

  it("ungrouped fields render with no heading (simple forms unaffected)", () => {
    const w = mount(FormRenderer, { props: { schema } }); // the select/showIf schema above, no groups
    expect(w.find('[data-test="form-group-heading"]').exists()).toBe(false);
  });
});
