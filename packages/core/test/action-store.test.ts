import { afterAll, beforeAll, expect, test } from "vitest";
import { createActionStore } from "../src/action/store";
import { createDb } from "../src/db";
import { testPool } from "./harness";

// Exercises the durable idempotent action-dispatch record against a live pool (see harness.ts /
// global-setup.ts — the dedicated core test DB, migrated via the library's own migrate()).
const pool = testPool();
const { query } = createDb(pool);
const store = createActionStore(query);

// A real notification row is needed: notification_id has a FK to notifications(id) ON DELETE CASCADE.
const NOTIFICATION_ID = "action-store-test-n1";

beforeAll(async () => {
  await query(
    `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope)
     VALUES ($1, 'test-module', 'Action store test', 'body', 'normal', false, 'global')
     ON CONFLICT (id) DO NOTHING`,
    [NOTIFICATION_ID],
  );
});

afterAll(async () => {
  await query("DELETE FROM action_dispatches WHERE notification_id = $1", [NOTIFICATION_ID]);
  await query("DELETE FROM notifications WHERE id = $1", [NOTIFICATION_ID]);
  await pool.end();
});

test("begin inserts a pending row once, then returns the same row idempotently", async () => {
  const a = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k1",
  });
  expect(a.created).toBe(true);
  expect(a.row.status).toBe("pending");

  const b = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k1",
  });
  expect(b.created).toBe(false);
  expect(b.row.id).toBe(a.row.id);
});

test("begin scopes the idempotency tuple per user — a different userKey is a distinct dispatch", async () => {
  const a = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "1",
    idempotencyKey: "k-shared",
  });
  const b = await store.begin({
    userKey: "u2",
    notificationId: NOTIFICATION_ID,
    actionRef: "1",
    idempotencyKey: "k-shared",
  });
  expect(b.created).toBe(true);
  expect(b.row.id).not.toBe(a.row.id);
});

test("complete records terminal status + message", async () => {
  const { row } = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k2",
  });
  await store.complete(row.id, "ok", "Approved");

  const again = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k2",
  });
  expect(again.created).toBe(false);
  expect(again.row).toMatchObject({ status: "ok", resultMessage: "Approved" });
});

test("complete can record a failed status with a result message", async () => {
  const { row } = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k3",
  });
  await store.complete(row.id, "failed", "Module timed out");

  const again = await store.begin({
    userKey: "u1",
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k3",
  });
  expect(again.row).toMatchObject({ status: "failed", resultMessage: "Module timed out" });
});
