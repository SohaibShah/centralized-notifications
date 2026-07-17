import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AssistantTab from "./AssistantTab.vue";

describe("AssistantTab", () => {
  it("shows a decorative, disabled gradient send button in the composer", () => {
    const wrapper = mount(AssistantTab);
    const send = wrapper.find('[data-test="ai-send"]');
    expect(send.exists()).toBe(true);
    expect(send.attributes("disabled")).toBeDefined(); // inert stub this pass
    expect(send.classes()).toContain("ai-gradient-bg");
  });
});
