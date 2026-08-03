import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { createTextGroupingStrategy } from "../src/grouping/text-strategy";
import { list } from "../src/read/feed";
import { persist } from "../src/pipeline/persist";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
const strat = createTextGroupingStrategy();
afterAll(() => pool.end());
const user = { userKey: `rg-${Date.now()}`, roles: [], teamKeys: [] };
const mk = (id: string, title: string) => ({
  id,
  module: "dsr",
  title,
  description: "",
  priority: "high" as const,
  snoozable: true,
  audience: { scope: "user" as const, id: user.userKey },
});

beforeAll(async () => {
  await query("DELETE FROM notifications WHERE audience_scope = 'global'");
  for (const [sfx, title] of [
    ["a", "DSAR #1042 overdue"],
    ["b", "DSAR #1042 verified"],
  ] as const) {
    const n = mk(`${user.userKey}-${sfx}`, title);
    await persist(query, n, false, strat.keyFor(n));
  }
});

test("feed items carry groupKey + groupLabel", async () => {
  const res = await list(query, { principal: user, limit: 50 });
  if (!res.ok) throw new Error(res.error);
  const item = res.page.items.find((i) => i.title.includes("overdue"))!;
  expect(item.groupKey).toBe("dsr:#1042");
  expect(item.groupLabel).toBe("DSAR #1042");
});
