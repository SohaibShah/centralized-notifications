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
