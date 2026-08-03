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
    ["e", "DSAR #1042 acknowledged", "high"], // same subject, but read → its own read-state stack
  ];
  for (const [sfx, title, p] of rows) {
    const n = mk(`${user.userKey}-${sfx}`, title, p);
    // Representative-order determinism doesn't rely on wall-clock: same-ms rows tie-break on id DESC,
    // both in the within-group row_number() and the outer keyset — so "b" wins its group regardless.
    await persist(query, n, false, strat.keyFor(n));
  }
  // "e" is read: it must split off into a separate read-state stack, not fold into the unread one.
  await query(`INSERT INTO notification_reads (user_key, notification_id) VALUES ($1, $2)`, [
    user.userKey,
    `${user.userKey}-e`,
  ]);
});

test("a subject with read + unread yields two entries, each counted by section", async () => {
  const res = await listGrouped(query, { principal: user, limit: 50 });
  if (!res.ok) throw new Error(res.error);
  const stacks = res.page.entries.filter((e) => e.groupKey === "dsr:#1042");
  expect(stacks.length).toBe(2); // one unread stack, one read stack
  const unread = stacks.find((e) => !e.read)!;
  const read = stacks.find((e) => e.read)!;
  expect(unread.groupTotal).toBe(2); // a + b, both unread
  expect(unread.topPriority).toBe("critical"); // min priority_rank in the unread partition
  expect(unread.title).toContain("overdue"); // representative = most recent member
  expect(read.groupTotal).toBe(1); // e, read
  expect("groupUnread" in unread).toBe(false); // per-section count replaces the unread aggregate
  // A kind-group with a single member renders as its own entry (total 1).
  const solo = res.page.entries.find((e) => e.title.includes("Weekly"))!;
  expect(solo.groupTotal).toBe(1);
  // A genuinely null-key row is its own entry too (partitioned by id via COALESCE).
  const nullKey = res.page.entries.find((e) => e.title.includes("2026-02-02"))!;
  expect(nullKey.groupKey == null).toBe(true);
  expect(nullKey.groupTotal).toBe(1);
});

test("sort=priority-high brings the group with the most-severe member to the top", async () => {
  const res = await listGrouped(query, { principal: user, limit: 50, sort: "priority-high" });
  if (!res.ok) throw new Error(res.error);
  // The dsr:#1042 unread stack holds the critical member, so it must sort ahead of every high/normal
  // group. (The read stack of the same subject holds only the "high" acknowledgement.)
  const first = res.page.entries[0]!;
  expect(first.groupKey).toBe("dsr:#1042");
  expect(first.read).toBe(false);
  expect(first.topPriority).toBe("critical");
});

test("a grouped cursor issued under one sort is rejected under another", async () => {
  const first = await listGrouped(query, { principal: user, limit: 1, sort: "newest" });
  if (!first.ok || !first.page.nextCursor) throw new Error("need a cursor");
  const bad = await listGrouped(query, {
    principal: user,
    cursor: first.page.nextCursor,
    sort: "priority-high",
  });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error).toBe("invalid cursor");
});

test("keyset-paginates the grouped feed with no overlap or skip", async () => {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await listGrouped(query, {
      principal: user,
      limit: 1,
      cursor,
      sort: "priority-high",
    });
    if (!res.ok) throw new Error(res.error);
    for (const e of res.page.entries) seen.push(e.id); // representative id is unique per (group, read) entry
    if (!res.page.nextCursor) break;
    cursor = res.page.nextCursor;
  }
  // Four distinct entries: dsr:#1042 unread stack, dsr:#1042 read stack, Weekly kind-group-of-1,
  // null-key standalone — the read-split turns the one subject into two.
  expect(seen.length).toBe(4);
  expect(new Set(seen).size).toBe(seen.length); // no dupes across pages
});

test("a malformed grouped cursor is rejected", async () => {
  const res = await listGrouped(query, { principal: user, cursor: "not-a-real-cursor" });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe("invalid cursor");
});
