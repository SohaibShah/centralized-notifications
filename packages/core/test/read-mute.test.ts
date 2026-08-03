import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { counts } from "../src/read/counts";
import { list } from "../src/read/feed";
import { createPreferencesStore } from "../src/preferences/store";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const store = createPreferencesStore(query);
afterAll(() => pool.end());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const user = { userKey: `mute-user-${stamp}`, roles: [], teamKeys: [] };

const snoozableId = `mute-snoozable-${stamp}`;
const criticalId = `mute-critical-${stamp}`;
const snoozableCriticalId = `mute-snoozcrit-${stamp}`;

const notif = (
  id: string,
  snoozable: boolean,
  priority: Notification["priority"],
): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  priority,
  snoozable,
  audience: { scope: "user", id: user.userKey },
});

beforeAll(async () => {
  // Sibling files seed GLOBAL-scoped notifications (visible to every principal) into this shared core
  // test DB — some from module 'dsr', which this test mutes. They'd be hidden by the mute too and
  // throw off the exact count delta. Clear them so this user's visible set is exactly its own 3 items.
  await query("DELETE FROM notifications WHERE audience_scope = 'global'");
  await persist(query, notif(snoozableId, true, "normal"), false);
  await persist(query, notif(criticalId, false, "critical"), false);
  await persist(query, notif(snoozableCriticalId, true, "critical"), false); // snoozable + critical
});

async function feedIds(): Promise<string[]> {
  const res = await list(query, { principal: user, limit: 100 });
  if (!res.ok) throw new Error(res.error);
  return res.page.items.map((i) => i.id);
}

async function mutedViewIds(): Promise<string[]> {
  const res = await list(query, { principal: user, limit: 100, view: "muted" });
  if (!res.ok) throw new Error(res.error);
  return res.page.items.map((i) => i.id);
}

test("with no rules all notifications are visible", async () => {
  const ids = await feedIds();
  expect(ids).toContain(snoozableId);
  expect(ids).toContain(criticalId);
  expect(ids).toContain(snoozableCriticalId);
});

test("muting the module hides its SNOOZABLE notifs (any priority) but not the non-snoozable one", async () => {
  const before = await counts(query, { principal: user });
  await store.putRule(user.userKey, "module", "dsr", null); // mute indefinitely

  const ids = await feedIds();
  expect(ids).not.toContain(snoozableId); // snoozable normal → hidden
  expect(ids).not.toContain(snoozableCriticalId); // snoozable critical → hidden (priority not a gate)
  expect(ids).toContain(criticalId); // non-snoozable critical → always through

  const after = await counts(query, { principal: user });
  expect(after.unread).toBe(before.unread - 2); // the two snoozable ones dropped; the critical stays
});

test("an expired snooze reveals the notification again", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await store.putRule(user.userKey, "module", "dsr", past); // snooze already expired
  expect(await feedIds()).toContain(snoozableId);
});

test("the muted view returns exactly what an active rule hides (inverse of the active feed)", async () => {
  await store.putRule(user.userKey, "module", "dsr", null); // mute the module indefinitely again

  const muted = await mutedViewIds();
  // Only the snoozable notifs the rule is actively hiding — any priority; the non-snoozable one is
  // never muted, so it never appears in the muted view.
  expect(muted).toContain(snoozableId);
  expect(muted).toContain(snoozableCriticalId);
  expect(muted).not.toContain(criticalId);

  // The muted view is the exact complement of the active feed: no item appears in both.
  const active = await feedIds();
  expect(active.some((id) => muted.includes(id))).toBe(false);
});

test("with no active rule the muted view is empty", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await store.putRule(user.userKey, "module", "dsr", past); // expire the mute → nothing hidden
  expect(await mutedViewIds()).toHaveLength(0);
});

test("a cursor is view-scoped: one issued under active is rejected when replayed under muted", async () => {
  // Force a page boundary in the active view so we get a real nextCursor to replay.
  const active = await list(query, { principal: user, limit: 1, view: "active" });
  if (!active.ok) throw new Error(active.error);
  expect(active.page.nextCursor).not.toBeNull();

  const crossView = await list(query, {
    principal: user,
    limit: 1,
    view: "muted",
    cursor: active.page.nextCursor!,
  });
  expect(crossView.ok).toBe(false);
  if (!crossView.ok) expect(crossView.error).toBe("invalid cursor");

  // Sanity: replayed under the SAME view it was issued for, it's accepted.
  const sameView = await list(query, {
    principal: user,
    limit: 1,
    view: "active",
    cursor: active.page.nextCursor!,
  });
  expect(sameView.ok).toBe(true);
});
