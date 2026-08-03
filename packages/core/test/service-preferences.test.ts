import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createNotificationService, type NotificationService } from "../src/service";
import { testPool } from "./harness";

const pool = testPool();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const principal = { userKey: `svc-pref-${stamp}`, roles: [], teamKeys: [] };
let svc: NotificationService;

beforeAll(async () => {
  svc = createNotificationService({
    pool,
    config: { modules: [{ id: "dsr", label: "DSR" }] },
  });
  await svc.ready();
});
afterAll(() => pool.end());

test("preferences round-trip through the service", async () => {
  expect(await svc.getPreferences({ principal })).toEqual({
    groupingEnabled: true,
    summaryOptOut: false,
    toastMinPriority: "critical",
  });

  const updated = await svc.updatePreferences({ principal, patch: { summaryOptOut: true } });
  expect(updated.summaryOptOut).toBe(true);
  expect((await svc.getPreferences({ principal })).summaryOptOut).toBe(true);
});

test("getMuteTargets reports catalog modules with the user's priority mix + categories", async () => {
  const mtUser = { userKey: `svc-mt-${stamp}`, roles: [], teamKeys: [] };
  const notif: Notification = {
    id: `mt-${stamp}`,
    module: "dsr",
    title: "mt",
    description: "",
    priority: "high",
    snoozable: true,
    category: "reports",
    audience: { scope: "user", id: mtUser.userKey },
  };
  await svc.ingest(notif);

  const t = await svc.getMuteTargets({ principal: mtUser });
  const dsr = t.modules.find((m) => m.id === "dsr");
  expect(dsr).toBeTruthy();
  expect(dsr!.label).toBe("DSR"); // catalog label, not the slug
  expect(dsr!.byPriority.high).toBeGreaterThanOrEqual(1);
  expect(dsr!.total).toBeGreaterThanOrEqual(1);
  expect(t.categories.some((c) => c.name === "reports")).toBe(true);
});

test("getMuteTargets keeps a muted category visible with zero counts", async () => {
  const mtUser = { userKey: `svc-mtcat-${stamp}`, roles: [], teamKeys: [] };
  await svc.putMuteRule({
    principal: mtUser,
    targetKind: "category",
    target: "phantom",
    until: null,
  });
  const t = await svc.getMuteTargets({ principal: mtUser });
  const phantom = t.categories.find((c) => c.name === "phantom");
  expect(phantom).toBeTruthy();
  expect(phantom!.total).toBe(0);
});

test("mute rules round-trip through the service", async () => {
  await svc.putMuteRule({ principal, targetKind: "module", target: "dsr", until: null });
  expect(await svc.listMuteRules({ principal })).toContainEqual({
    targetKind: "module",
    target: "dsr",
    mutedUntil: null,
  });

  expect(await svc.deleteMuteRule({ principal, targetKind: "module", target: "dsr" })).toBe(true);
  expect(await svc.listMuteRules({ principal })).toEqual([]);
});
