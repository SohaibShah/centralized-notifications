import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import NotificationProvider from "./NotificationProvider.vue";
import { useFeed, useUser } from "./context";

const Probe = defineComponent({
  setup() {
    const feed = useFeed();
    const user = useUser();
    return () =>
      h(
        "div",
        { "data-test": "probe" },
        `${typeof feed.load}:${user.value?.roles.join(",") ?? "none"}`,
      );
  },
});

describe("NotificationProvider", () => {
  it("provides state to descendants and injects the user; wraps a .notifications-root", () => {
    const w = mount(NotificationProvider, {
      props: { config: { baseUrl: "", user: { roles: ["admin"] } } },
      slots: { default: () => h(Probe) },
    });
    expect(w.find('[data-test="probe"]').text()).toBe("function:admin");
    expect(w.find(".notifications-root").exists()).toBe(true);
  });

  it("useFeed() outside a provider throws a helpful error", () => {
    expect(() => mount(Probe)).toThrow(/NotificationProvider/);
  });
});
