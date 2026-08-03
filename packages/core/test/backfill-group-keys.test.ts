import { afterAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { backfillGroupKeys } from "../src/maintenance/backfill-group-keys";
import { createTextGroupingStrategy } from "../src/grouping/text-strategy";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

test("backfill stamps keys on rows that have none", async () => {
  const id = `bf-${Date.now()}`;
  // Insert directly with NULL group_key (simulating a pre-feature row).
  await query(
    `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope)
     VALUES ($1, 'dsr', 'DSAR #77 overdue', '', 'high', true, 'global')`,
    [id],
  );
  const res = await backfillGroupKeys(query, createTextGroupingStrategy(), 500);
  expect(res.updated).toBeGreaterThanOrEqual(1);
  const { rows } = await query<{ group_key: string }>(
    "SELECT group_key FROM notifications WHERE id = $1",
    [id],
  );
  expect(rows[0].group_key).toBe("dsr:#77");
});
