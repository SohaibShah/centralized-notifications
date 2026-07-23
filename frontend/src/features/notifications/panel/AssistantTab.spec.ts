import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { chatState, settingsState, sendSpy } = vi.hoisted(() => ({
  chatState: {
    thread: [] as {
      from: "me" | "ai";
      text: string;
      sources: Record<string, unknown>;
    }[],
    status: "idle",
  },
  settingsState: { flags: { chatbotEnabled: true } },
  sendSpy: vi.fn(),
}));

vi.mock("@/stores/chat", () => ({ useChatStore: () => chatState }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settingsState }));
// CitationChip (rendered for known refs) pulls in the shared action composable → feed store; stub it
// so this component test needs no Pinia.
vi.mock("@/composables/useNotificationActions", () => ({
  useNotificationActions: () => ({ runAction: vi.fn() }),
}));

// Wire the spy into the reactive store's send after the mocks are defined.
(chatState as unknown as { send: typeof sendSpy }).send = sendSpy;

const AssistantTab = (await import("./AssistantTab.vue")).default;

describe("AssistantTab", () => {
  beforeEach(() => {
    chatState.thread = [];
    chatState.status = "idle";
    settingsState.flags.chatbotEnabled = true;
    sendSpy.mockReset();
  });

  it("submitting a question calls chat.send and clears the input", async () => {
    const wrapper = mount(AssistantTab);
    const input = wrapper.find('[data-test="ai-input"]');
    await input.setValue("what's urgent?");
    await wrapper.find("form").trigger("submit");
    expect(sendSpy).toHaveBeenCalledWith("what's urgent?");
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("renders me/ai bubbles from the store thread", () => {
    chatState.thread = [
      { from: "me", text: "hi", sources: {} },
      { from: "ai", text: "hello there", sources: {} },
    ];
    const wrapper = mount(AssistantTab);
    expect(wrapper.text()).toContain("hi");
    expect(wrapper.text()).toContain("hello there");
  });

  it("renders [n#] markers with a matching source as citation chips; unknown refs stay text", () => {
    chatState.thread = [
      { from: "me", text: "hi", sources: {} },
      {
        from: "ai",
        text: "The Acme DSAR [n1] is overdue; [n9] is unknown.",
        sources: {
          n1: {
            ref: "n1",
            id: "a1",
            title: "Acme DSAR",
            priority: "critical",
            ageMinutes: 5,
            actions: [],
          },
        },
      },
    ];
    const wrapper = mount(AssistantTab);
    expect(wrapper.find('[data-test="chip-toggle"]').text()).toContain("Acme DSAR");
    expect(wrapper.text()).toContain("[n9]"); // unknown ref → left as plain text
  });

  it("does not submit an empty question", async () => {
    const wrapper = mount(AssistantTab);
    await wrapper.find("form").trigger("submit");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("hides the composer and shows an off state when chatbot is disabled", () => {
    settingsState.flags.chatbotEnabled = false;
    const wrapper = mount(AssistantTab);
    expect(wrapper.find('[data-test="ai-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-off"]').exists()).toBe(true);
  });
});
