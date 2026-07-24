import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";
import { createNotificationActions } from "./actions";

const markReadSpy = vi.fn();
const setActionsSpy = vi.fn();
const feed = { markRead: markReadSpy, setActions: setActionsSpy };

const postMock = vi.fn();
const transport = { post: postMock } as unknown as Parameters<
  typeof createNotificationActions
>[0]["transport"];

const fakeSettings = (actionsEnabled: boolean) => ({ flags: { actionsEnabled } });

describe("notification actions", () => {
  beforeEach(() => {
    markReadSpy.mockReset();
    setActionsSpy.mockReset();
    postMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a link action opens the url and marks the notification read", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { runAction } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(true),
    });
    const action: NotificationAction = {
      label: "Open",
      kind: "link",
      method: "GET",
      url: "https://x/1",
    };
    runAction(action, { id: "abc", ref: 0 });
    expect(markReadSpy).toHaveBeenCalledWith("abc");
    expect(open).toHaveBeenCalledWith("https://x/1", "_blank", "noopener,noreferrer");
  });

  it("dispatch: posts with an idempotency key and applies resolve -> markRead", async () => {
    postMock.mockResolvedValueOnce({
      ok: true,
      message: "Approved",
      resolve: true,
    } satisfies ModuleActionResponse);
    const { runAction, resultFor } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(true),
    });
    const action: NotificationAction = {
      label: "Approve",
      kind: "dispatch",
      method: "POST",
      path: "/actions/approve",
    };
    await runAction(action, { id: "n1", ref: 0 });
    expect(postMock).toHaveBeenCalledWith(
      "/notifications/n1/actions/0/dispatch",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(markReadSpy).toHaveBeenCalledWith("n1");
    expect(resultFor("n1", 0)).toEqual({ ok: true, message: "Approved" });
  });

  it("dispatch: replaces the card's actions when the response carries actions", async () => {
    const newActions: NotificationAction[] = [
      { label: "Undo", kind: "dispatch", method: "POST", path: "/actions/undo" },
    ];
    postMock.mockResolvedValueOnce({
      ok: true,
      actions: newActions,
    } satisfies ModuleActionResponse);
    const { runAction } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(true),
    });
    await runAction(
      { label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" },
      { id: "n2", ref: 1 },
    );
    expect(setActionsSpy).toHaveBeenCalledWith("n2", newActions);
  });

  it("dispatch: on ok:false surfaces the message and does NOT mark read", async () => {
    postMock.mockResolvedValueOnce({
      ok: false,
      message: "Already resolved",
    } satisfies ModuleActionResponse);
    const { runAction, resultFor } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(true),
    });
    await runAction(
      { label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" },
      { id: "n3", ref: 0 },
    );
    expect(markReadSpy).not.toHaveBeenCalled();
    expect(setActionsSpy).not.toHaveBeenCalled();
    expect(resultFor("n3", 0)).toEqual({ ok: false, message: "Already resolved" });
  });

  it("dispatch: a thrown transport error stores a failure result and clears pending", async () => {
    postMock.mockRejectedValueOnce(new Error("network"));
    const { runAction, resultFor, isPending } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(true),
    });
    const target = { id: "n4", ref: 0 };
    const action: NotificationAction = {
      label: "Approve",
      kind: "dispatch",
      method: "POST",
      path: "/actions/approve",
    };
    await runAction(action, target);
    expect(resultFor("n4", 0)).toEqual({ ok: false, message: "Action failed" });
    expect(isPending("n4", 0)).toBe(false);
  });

  it("dispatch: does nothing when actionsEnabled is off", async () => {
    const { runAction } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(false),
    });
    await runAction(
      { label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" },
      { id: "n5", ref: 0 },
    );
    expect(postMock).not.toHaveBeenCalled();
    expect(markReadSpy).not.toHaveBeenCalled();
  });

  it("dispatch: a second call while pending is ignored (double-fire guard)", async () => {
    let resolvePost!: (v: ModuleActionResponse) => void;
    postMock.mockReturnValueOnce(
      new Promise<ModuleActionResponse>((resolve) => (resolvePost = resolve)),
    );
    const { runAction, isPending } = createNotificationActions({
      feed,
      transport,
      settings: fakeSettings(true),
    });
    const action: NotificationAction = {
      label: "Approve",
      kind: "dispatch",
      method: "POST",
      path: "/actions/approve",
    };
    const first = runAction(action, { id: "n6", ref: 0 });
    expect(isPending("n6", 0)).toBe(true);
    await runAction(action, { id: "n6", ref: 0 }); // ignored — already pending
    expect(postMock).toHaveBeenCalledTimes(1);
    resolvePost({ ok: true });
    await first;
    expect(isPending("n6", 0)).toBe(false);
  });
});
