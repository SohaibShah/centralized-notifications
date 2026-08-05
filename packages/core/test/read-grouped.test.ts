import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { createTextGroupingStrategy } from "../src/grouping/text-strategy";
import { list } from "../src/read/feed";
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

test("priorities filter narrows each group to matching members and drops empty groups", async () => {
  const res = await listGrouped(query, { principal: user, limit: 50, priorities: ["critical"] });
  if (!res.ok) throw new Error(res.error);
  // dsr:#1042 unread stack had a(normal)+b(critical); filtered to critical → only b survives.
  const dsr = res.page.entries.filter((e) => e.groupKey === "dsr:#1042");
  expect(dsr.length).toBe(1);
  expect(dsr[0]!.groupTotal).toBe(1);
  expect(dsr[0]!.topPriority).toBe("critical");
  expect(dsr[0]!.read).toBe(false);
  // Groups with no critical member disappear entirely.
  expect(res.page.entries.some((e) => e.title.includes("Weekly"))).toBe(false);
  expect(res.page.entries.some((e) => e.title.includes("2026-02-02"))).toBe(false);
});

test("multiple priorities include any-of; module filter scopes by module", async () => {
  const both = await listGrouped(query, {
    principal: user,
    limit: 50,
    priorities: ["critical", "normal"],
  });
  if (!both.ok) throw new Error(both.error);
  // Now a(normal)+b(critical) both count → the unread dsr stack is back to 2.
  const dsr = both.page.entries.find((e) => e.groupKey === "dsr:#1042" && !e.read)!;
  expect(dsr.groupTotal).toBe(2);

  const inDsr = await listGrouped(query, { principal: user, limit: 50, modules: ["dsr"] });
  if (!inDsr.ok) throw new Error(inDsr.error);
  expect(inDsr.page.entries.length).toBeGreaterThan(0); // all seed rows are module 'dsr'
  const other = await listGrouped(query, { principal: user, limit: 50, modules: ["billing"] });
  if (!other.ok) throw new Error(other.error);
  expect(other.page.entries.length).toBe(0);
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

test("a group drill-in can be scoped to one read-state (read-split See all / peek)", async () => {
  // Unread stack drill-in: only the unread members (a, b) of dsr:#1042 — not the read one (e).
  const unread = await list(query, { principal: user, group: "dsr:#1042", read: false, limit: 50 });
  if (!unread.ok) throw new Error(unread.error);
  expect(unread.page.items.every((n) => !n.read)).toBe(true);
  expect(unread.page.items.length).toBe(2);
  // Read stack drill-in: only the read member (e).
  const read = await list(query, { principal: user, group: "dsr:#1042", read: true, limit: 50 });
  if (!read.ok) throw new Error(read.error);
  expect(read.page.items.every((n) => n.read)).toBe(true);
  expect(read.page.items.length).toBe(1);
  // A read-scoped cursor is rejected if replayed without the same read filter.
  const p1 = await list(query, { principal: user, group: "dsr:#1042", read: false, limit: 1 });
  if (!p1.ok || !p1.page.nextCursor) throw new Error("need a cursor");
  const crossed = await list(query, {
    principal: user,
    group: "dsr:#1042",
    cursor: p1.page.nextCursor,
  });
  expect(crossed.ok).toBe(false);
});
