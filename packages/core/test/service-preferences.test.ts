import { afterAll, beforeAll, expect, test } from "vitest";
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
