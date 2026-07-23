import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { buildSummaryContext } from "../src/ai/summarize";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const principal = { userKey: `sctx-${stamp}`, roles: [], teamKeys: [] };
const critId = `sctx-crit-${stamp}`;
const normId = `sctx-norm-${stamp}`;
const readId = `sctx-read-${stamp}`;

const notif = (id: string, priority: Notification["priority"]): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "x".repeat(400), // long enough to prove truncation
  priority,
  snoozable: false,
  audience: { scope: "global" },
});

beforeAll(async () => {
  await persist(query, notif(critId, "critical"), false);
  await persist(query, notif(normId, "normal"), false);
  await persist(query, notif(readId, "high"), false);
  // Mark readId read for this principal so it's excluded from the unread context.
  await query("INSERT INTO notification_reads (user_key, notification_id) VALUES ($1, $2)", [
    principal.userKey,
    readId,
  ]);
});

test("context is critical-first, excludes read, and shapes each item", async () => {
  const { context, ids } = await buildSummaryContext(query, principal, 25);
  const mine = context.items.filter((i) => i.title.startsWith("sctx-"));
  expect(mine.map((i) => i.title)).toEqual([critId, normId]); // critical before normal, read excluded
  expect(ids).toContain(critId);
  expect(ids).not.toContain(readId);

  const crit = mine[0]!;
  expect(crit.priority).toBe("critical");
  expect(crit.module).toBe("dsr");
  expect(crit.description.length).toBe(280); // truncated
  expect(typeof crit.ageMinutes).toBe("number");
  expect(crit.ageMinutes).toBeGreaterThanOrEqual(0);
  expect(crit.hasActions).toBe(false);
  expect(context.totalUnread).toBeGreaterThanOrEqual(2);
});
