import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { NotificationAction } from "@notifications/shared";

const { markReadSpy } = vi.hoisted(() => ({ markReadSpy: vi.fn() }));
vi.mock("@/stores/feed", () => ({ useFeedStore: () => ({ markRead: markReadSpy }) }));

const { useNotificationActions } = await import("./useNotificationActions");

describe("useNotificationActions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    markReadSpy.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a link action opens the url and marks the notification read", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { runAction } = useNotificationActions();
    const action: NotificationAction = {
      label: "Open",
      kind: "link",
      method: "GET",
      url: "https://x/1",
    };
    runAction(action, { id: "abc" });
    expect(markReadSpy).toHaveBeenCalledWith("abc");
    expect(open).toHaveBeenCalledWith("https://x/1", "_blank", "noopener,noreferrer");
  });

  it("a dispatch action marks read but does not open a url (stub)", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { runAction } = useNotificationActions();
    runAction({ label: "Do", kind: "dispatch", method: "POST", url: "https://x/2" }, { id: "def" });
    expect(markReadSpy).toHaveBeenCalledWith("def");
    expect(open).not.toHaveBeenCalled();
  });
});
