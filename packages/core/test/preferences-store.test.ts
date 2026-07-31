import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { createPreferencesStore } from "../src/preferences/store";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const store = createPreferencesStore(query);

// Unique key per run so the shared core test DB doesn't collide across files.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userKey = (suffix: string) => `pref-user-${stamp}-${suffix}`;

beforeAll(async () => {
  await query("SELECT 1"); // ensure the pool connects (schema built by global-setup)
});
afterAll(() => pool.end());

test("returns column defaults for a user with no row", async () => {
  const prefs = await store.getPreferences(userKey("defaults"));
  expect(prefs).toEqual({
    groupingEnabled: true,
    summaryOptOut: false,
    toastMinPriority: "critical",
  });
});

test("updatePreferences upserts and partial-updates", async () => {
  const key = userKey("update");
  const afterFirst = await store.updatePreferences(key, { summaryOptOut: true });
  expect(afterFirst.summaryOptOut).toBe(true);
  expect(afterFirst.groupingEnabled).toBe(true); // untouched default

  // A second partial update must not reset the previously-set field.
  const afterSecond = await store.updatePreferences(key, { toastMinPriority: "off" });
  expect(afterSecond.toastMinPriority).toBe("off");
  expect(afterSecond.summaryOptOut).toBe(true); // still set from the first update
  expect(afterSecond.groupingEnabled).toBe(true);

  expect(await store.getPreferences(key)).toEqual({
    groupingEnabled: true,
    summaryOptOut: true,
    toastMinPriority: "off",
  });
});

test("putRule upserts a rule and listRules reflects it; deleteRule removes it", async () => {
  const key = userKey("rules");
  expect(await store.listRules(key)).toEqual([]);

  await store.putRule(key, "module", "dsr", null); // mute
  const until = "2099-01-01T08:00:00.000Z";
  await store.putRule(key, "category", "marketing", until); // snooze

  const rules = await store.listRules(key);
  expect(rules).toContainEqual({ targetKind: "module", target: "dsr", mutedUntil: null });
  expect(rules).toContainEqual({ targetKind: "category", target: "marketing", mutedUntil: until });

  // Upsert (not duplicate) — change the module rule to a snooze.
  await store.putRule(key, "module", "dsr", until);
  const updated = await store.listRules(key);
  expect(updated.filter((r) => r.target === "dsr")).toHaveLength(1);
  expect(updated.find((r) => r.target === "dsr")?.mutedUntil).toBe(until);

  expect(await store.deleteRule(key, "module", "dsr")).toBe(true);
  expect(await store.deleteRule(key, "module", "dsr")).toBe(false); // already gone
  expect((await store.listRules(key)).some((r) => r.target === "dsr")).toBe(false);
});
