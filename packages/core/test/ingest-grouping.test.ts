import { afterAll, expect, test } from "vitest";
import { createDb } from "../src/db";
import { createNotificationService } from "../src/service";
import { testPool } from "./harness";

const pool = testPool();
const svc = createNotificationService({ pool, config: { modules: [{ id: "dsr", label: "DSR" }] } });
const { query } = createDb(pool);
afterAll(() => pool.end());

test("ingest stamps group_key + group_label from the default strategy", async () => {
  await svc.ready();
  const id = `grp-${Date.now()}`;
  await svc.ingest({
    id,
    module: "dsr",
    title: "DSAR #1042 overdue",
    description: "",
    priority: "high",
    snoozable: true,
    audience: { scope: "global" },
  });
  const { rows } = await query<{ group_key: string; group_label: string }>(
    "SELECT group_key, group_label FROM notifications WHERE id = $1",
    [id],
  );
  expect(rows[0].group_key).toBe("dsr:#1042");
  expect(rows[0].group_label).toBe("DSAR #1042");
});

test("a standalone title persists a null group_key", async () => {
  const id = `grp-solo-${Date.now()}`;
  await svc.ingest({
    id,
    module: "dsr",
    title: "2026-01-01 00:00",
    description: "",
    priority: "low",
    snoozable: true,
    audience: { scope: "global" },
  });
  const { rows } = await query<{ group_key: string | null }>(
    "SELECT group_key FROM notifications WHERE id = $1",
    [id],
  );
  expect(rows[0].group_key).toBeNull();
});
