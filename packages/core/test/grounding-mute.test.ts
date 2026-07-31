import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { buildSummaryContext } from "../src/ai/summarize";
import { retrieveForAnswer } from "../src/ai/retrieve";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { createPreferencesStore } from "../src/preferences/store";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const store = createPreferencesStore(query);
afterAll(() => pool.end());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const principal = { userKey: `gmute-${stamp}`, roles: [], teamKeys: [] };
const mutedId = `gmute-snoozable-${stamp}`;

const notif = (id: string): Notification => ({
  id,
  module: "reports",
  title: `quarterly reports digest ${id}`,
  description: "a snoozable reports notification",
  priority: "normal",
  snoozable: true,
  audience: { scope: "user", id: principal.userKey },
});

beforeAll(async () => {
  await persist(query, notif(mutedId), false);
});

// The shared core test DB also holds global-scoped notifications from sibling files (visible to
// every principal), so assertions use deltas against a pre-mute baseline rather than absolute counts.
test("muting a module excludes it from summary AND chat grounding", async () => {
  const summaryBefore = await buildSummaryContext(query, principal, 25);
  expect(summaryBefore.ids).toContain(mutedId);
  const chatBefore = await retrieveForAnswer(query, principal, "reports");
  expect(chatBefore.items.some((i) => i.id === mutedId)).toBe(true);
  const totalBefore = chatBefore.stats.total;

  await store.putRule(principal.userKey, "module", "reports", null); // mute

  const summaryAfter = await buildSummaryContext(query, principal, 25);
  expect(summaryAfter.ids).not.toContain(mutedId);

  const chatAfter = await retrieveForAnswer(query, principal, "reports");
  expect(chatAfter.items.some((i) => i.id === mutedId)).toBe(false);
  expect(chatAfter.stats.total).toBe(totalBefore - 1); // exactly the muted notif dropped
});
