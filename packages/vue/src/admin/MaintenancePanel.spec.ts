import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { NOTIFICATIONS_KEY } from "../provider/context";
import { buildTestContext } from "../test/provider-harness";

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  patchAdminSettings: vi.fn(),
  deleteAllNotifications: vi.fn(),
  deleteReadNotifications: vi.fn(),
  deleteNotificationsOlderThan: vi.fn(),
  resetModules: vi.fn(),
  resetSettings: vi.fn(),
}));
vi.mock("./adminApi", () => ({ createAdminApi: () => mocks }));
const { default: MaintenancePanel } = await import("./MaintenancePanel.vue");

const mountPanel = () =>
  mount(MaintenancePanel, {
    global: { provide: { [NOTIFICATIONS_KEY]: buildTestContext() } },
  });

describe("MaintenancePanel", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getAdminSettings.mockResolvedValue({
      aiSummaryEnabled: true,
      chatbotEnabled: true,
      groupingEnabled: true,
      actionsEnabled: true,
      retentionDays: 30,
    });
    mocks.deleteReadNotifications.mockResolvedValue({ deleted: 7 });
    mocks.deleteAllNotifications.mockResolvedValue({ deleted: 12 });
  });

  it("runs a simple-confirm op (delete-read) after confirmation and shows the count", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="op-delete-read"]').trigger("click"); // reveals inline confirm
    await w.get('[data-test="op-delete-read-confirm"]').trigger("click");
    await flushPromises();
    expect(mocks.deleteReadNotifications).toHaveBeenCalledOnce();
    expect(w.text()).toContain("Deleted 7");
  });

  it("gates delete-all behind a typed confirmation", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="op-delete-all"]').trigger("click");
    const confirmBtn = w.get('[data-test="op-delete-all-confirm"]');
    expect(confirmBtn.attributes("disabled")).toBeDefined(); // disabled until the word is typed
    await w.get('[data-test="op-delete-all-input"]').setValue("DELETE");
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(mocks.deleteAllNotifications).toHaveBeenCalledOnce();
    expect(w.text()).toContain("Deleted 12");
  });

  it("saves the retention window", async () => {
    mocks.patchAdminSettings.mockResolvedValue(undefined);
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="retention-input"]').setValue("14");
    await w.get('[data-test="retention-save"]').trigger("click");
    await flushPromises();
    expect(mocks.patchAdminSettings).toHaveBeenCalledWith({ retentionDays: 14 });
  });

  it("disables the retention Save button when the input is cleared to an invalid value", async () => {
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="retention-input"]').setValue("");
    expect(w.get('[data-test="retention-save"]').attributes("disabled")).toBeDefined();
  });
});
