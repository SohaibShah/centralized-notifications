import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { createTextGroupingStrategy } from "../src/grouping/text-strategy";
import { listGrouped } from "../src/read/grouped";
import { persist } from "../src/pipeline/persist";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const strat = createTextGroupingStrategy();
afterAll(() => pool.end());
const user = { userKey: `gr-${Date.now()}`, roles: [], teamKeys: [] };
const mk = (id: string, title: string, priority: "high" | "critical" | "normal" = "high") => ({
  id,
  module: "dsr",
  title,
  description: "",
  priority,
  snoozable: true,
  audience: { scope: "user" as const, id: user.userKey },
});

beforeAll(async () => {
  await query("DELETE FROM notifications WHERE audience_scope = 'global'");
  const rows: Array<[string, string, "high" | "critical" | "normal"]> = [
    ["a", "DSAR #1042 received", "normal"],
    ["b", "DSAR #1042 overdue", "critical"], // same group, higher severity, newest
    ["c", "Weekly report ready", "high"], // kind group of 1
    ["d", "2026-02-02 09:00", "high"], // null group_key (template empties) — standalone via COALESCE
  ];
  for (const [sfx, title, p] of rows) {
    const n = mk(`${user.userKey}-${sfx}`, title, p);
    // small delay so created_at ordering is deterministic (b newest)
    await persist(query, n, false, strat.keyFor(n));
  }
});

test("one entry per group; aggregates + topPriority correct; standalone as total 1", async () => {
  const res = await listGrouped(query, { principal: user, limit: 50 });
  if (!res.ok) throw new Error(res.error);
  const dsar = res.page.entries.find((e) => e.groupKey === "dsr:#1042")!;
  expect(dsar.groupTotal).toBe(2);
  expect(dsar.groupUnread).toBe(2);
  expect(dsar.topPriority).toBe("critical"); // min priority_rank in the group
  expect(dsar.title).toContain("overdue"); // representative = most recent member
  // A kind-group with a single member renders as its own entry (total 1).
  const solo = res.page.entries.find((e) => e.title.includes("Weekly"))!;
  expect(solo.groupTotal).toBe(1);
  // A genuinely null-key row is its own entry too (partitioned by id via COALESCE).
  const nullKey = res.page.entries.find((e) => e.title.includes("2026-02-02"))!;
  expect(nullKey.groupKey == null).toBe(true);
  expect(nullKey.groupTotal).toBe(1);
});
