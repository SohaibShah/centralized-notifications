import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useNotificationPanelStore } from "./notificationPanel";

describe("notificationPanel store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opens, closes, and toggles", () => {
    const p = useNotificationPanelStore();
    expect(p.isOpen).toBe(false);
    p.open();
    expect(p.isOpen).toBe(true);
    p.close();
    expect(p.isOpen).toBe(false);
    p.toggle();
    expect(p.isOpen).toBe(true);
  });
});
