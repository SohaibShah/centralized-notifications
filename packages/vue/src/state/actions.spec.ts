import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationAction } from "@notifications/shared";
import { createNotificationActions } from "./actions";

const markReadSpy = vi.fn();
const feed = { markRead: markReadSpy };

describe("notification actions", () => {
  beforeEach(() => markReadSpy.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("a link action opens the url and marks the notification read", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { runAction } = createNotificationActions({ feed });
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
    const { runAction } = createNotificationActions({ feed });
    runAction({ label: "Do", kind: "dispatch", method: "POST", url: "https://x/2" }, { id: "def" });
    expect(markReadSpy).toHaveBeenCalledWith("def");
    expect(open).not.toHaveBeenCalled();
  });
});
