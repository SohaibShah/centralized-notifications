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
  await persist(query, notif(snoozableId, true, "normal"), false);
  await persist(query, notif(criticalId, false, "critical"), false);
  await persist(query, notif(snoozableCriticalId, true, "critical"), false); // snoozable + critical
});

async function feedIds(): Promise<string[]> {
  const res = await list(query, { principal: user, limit: 100 });
  if (!res.ok) throw new Error(res.error);
  return res.page.items.map((i) => i.id);
}

test("with no rules all notifications are visible", async () => {
  const ids = await feedIds();
  expect(ids).toContain(snoozableId);
  expect(ids).toContain(criticalId);
  expect(ids).toContain(snoozableCriticalId);
});

test("muting the module hides ALL its notifications — every priority + snoozable flag", async () => {
  const before = await counts(query, { principal: user });
  await store.putRule(user.userKey, "module", "dsr", null); // mute indefinitely

  const ids = await feedIds();
  expect(ids).not.toContain(snoozableId); // snoozable normal → hidden
  expect(ids).not.toContain(criticalId); // non-snoozable critical → hidden (user's mute wins)
  expect(ids).not.toContain(snoozableCriticalId); // snoozable critical → hidden

  const after = await counts(query, { principal: user });
  expect(after.unread).toBe(before.unread - 3); // all three dropped from the count
});

test("an expired snooze reveals the notification again", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await store.putRule(user.userKey, "module", "dsr", past); // snooze already expired
  expect(await feedIds()).toContain(snoozableId);
});
