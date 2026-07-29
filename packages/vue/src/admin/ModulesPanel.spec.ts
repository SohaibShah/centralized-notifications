import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { NOTIFICATIONS_KEY } from "../provider/context";
import { buildTestContext } from "../test/provider-harness";
import type { Transport } from "../transport/types";
import ModulesPanel from "./ModulesPanel.vue";

const getMock = vi.fn();
const patchMock = vi.fn();
const transport = {
  get: getMock,
  post: vi.fn(),
  patch: patchMock,
  del: vi.fn(),
} as unknown as Transport;

const mountPanel = () =>
  mount(ModulesPanel, {
    global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext({ transport }) } },
  });

// A factory, not a shared constant: the component mutates module objects in place (optimistic
// updates), so reusing one array across tests would leak a prior test's baseUrl/enabled edits
// into the next. Each test gets its own fresh copy via `getMock.mockResolvedValue(buildMods())`.
const buildMods = () => [
  {
    key: "dsar",
    label: "Dsar",
    enabled: true,
    lastSeenAt: "2026-07-16T00:00:00.000000Z",
    total: 5,
    suppressed: 0,
    byPriority: { critical: 1, high: 2, normal: 2, low: 0 },
    baseUrl: null as string | null,
  },
  {
    key: "billing",
    label: "Billing",
    enabled: true,
    lastSeenAt: "2026-07-16T00:00:00.000000Z",
    total: 2,
    suppressed: 0,
    byPriority: { critical: 0, high: 0, normal: 2, low: 0 },
    baseUrl: "https://billing.internal/api" as string | null,
  },
];

describe("ModulesPanel", () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue(buildMods());
    patchMock.mockResolvedValue(undefined);
  });

  it("filters to modules emitting the selected priority", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).toContain("Billing");
    await wrapper.get('[data-test="filter-critical"]').trigger("click");
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).not.toContain("Billing"); // billing has 0 critical
  });

  it("toggling a module PATCHes enabled optimistically", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="toggle-dsar"]').trigger("click");
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", { enabled: false });
  });

  it("shows an empty state when there are no modules", async () => {
    getMock.mockResolvedValueOnce([]);
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("No modules configured");
  });

  it("renders the module label as static text (no rename control)", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.find('[data-test="rename-dsar"]').exists()).toBe(false);
  });

  it("renders a base URL input per module, reflecting the current value", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const dsarInput = wrapper.get<HTMLInputElement>('[data-test="base-url-dsar"]');
    expect(dsarInput.element.value).toBe("");
    const billingInput = wrapper.get<HTMLInputElement>('[data-test="base-url-billing"]');
    expect(billingInput.element.value).toBe("https://billing.internal/api");
  });

  it("editing and saving the base URL PATCHes the module", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="base-url-dsar"]').setValue("http://localhost:4000/dsar");
    await wrapper.get('[data-test="base-url-save-dsar"]').trigger("click");
    await flushPromises();
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", {
      baseUrl: "http://localhost:4000/dsar",
    });
  });

  it("clearing the base URL and saving PATCHes null", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="base-url-billing"]').setValue("");
    await wrapper.get('[data-test="base-url-save-billing"]').trigger("click");
    await flushPromises();
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/billing", { baseUrl: null });
  });

  it("disables Save and shows a spinner while the base URL patch is in flight", async () => {
    let resolvePatch: (() => void) | undefined;
    patchMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePatch = () => resolve();
      }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="base-url-dsar"]').setValue("http://localhost:4000/dsar");
    const saveButton = wrapper.get<HTMLButtonElement>('[data-test="base-url-save-dsar"]');
    await saveButton.trigger("click");
    expect(saveButton.element.disabled).toBe(true);
    expect(wrapper.find('[data-test="base-url-save-dsar"] svg').exists()).toBe(true); // spinner
    resolvePatch?.();
    await flushPromises();
    expect(saveButton.element.disabled).toBe(true); // dirty is now false again (draft == saved value)
  });

  it("shows 'Saved' after a successful base URL save", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="base-url-dsar"]').setValue("http://localhost:4000/dsar");
    await wrapper.get('[data-test="base-url-save-dsar"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-test="base-url-result-dsar"]').text()).toBe("Saved");
  });

  it("shows a 'Couldn't save' alert and reverts the value after a failed base URL save", async () => {
    patchMock.mockRejectedValueOnce(new Error("network error"));
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="base-url-dsar"]').setValue("http://localhost:4000/dsar");
    await wrapper.get('[data-test="base-url-save-dsar"]').trigger("click");
    await flushPromises();
    const result = wrapper.get('[data-test="base-url-result-dsar"]');
    expect(result.attributes("role")).toBe("alert");
    expect(result.text()).toMatch(/couldn't save/i);
    // Reverted: the draft input is back to the pre-edit (empty) value.
    expect(wrapper.get<HTMLInputElement>('[data-test="base-url-dsar"]').element.value).toBe("");
  });

  it("shows a validation hint and disables save for a non-http(s) value", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="base-url-dsar"]').setValue("not-a-url");
    expect(wrapper.get('[data-test="base-url-hint-dsar"]').text()).toMatch(/http/i);
    expect(
      wrapper.get<HTMLButtonElement>('[data-test="base-url-save-dsar"]').element.disabled,
    ).toBe(true);
    await wrapper.get('[data-test="base-url-save-dsar"]').trigger("click");
    expect(patchMock).not.toHaveBeenCalledWith("/admin/modules/dsar", expect.anything());
  });
});
