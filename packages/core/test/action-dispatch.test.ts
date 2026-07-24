import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createDb } from "../src/db";
import {
  ActionsDisabledError,
  ModuleUnavailableError,
  NotFoundError,
  createNotificationService,
  type NotificationService,
} from "../src";
import type { ActionDispatcher, Principal } from "../src/types";
import { testPool } from "./harness";

// Exercises the security-critical uniform action dispatcher against a live pool (see harness.ts).
// The concrete outbound HTTP dispatcher is INJECTED — here a vi.fn() fake — so core stays
// identity/env-free and every branch is drivable without a real module server.

const pool = testPool();
const { query } = createDb(pool);

const MODULE = "dsr";
const NOTIFICATION_ID = "action-dispatch-test-n1";
const BASE_URL = "http://localhost:4000/dsr";

const principal: Principal = { userKey: "u-actor", roles: [], teamKeys: [] };
const other: Principal = { userKey: "u-other", roles: [], teamKeys: [] };

// Index 0 is a dispatch action (what we drive); index 1 is a link (must be rejected as non-dispatch).
const ACTIONS = [
  { label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" },
  { label: "Open", kind: "link", method: "GET", url: "https://example.test/open" },
];

const dispatcher: ActionDispatcher = { dispatch: vi.fn() };
let service: NotificationService;

beforeAll(async () => {
  service = createNotificationService({
    pool,
    config: { modules: [{ id: MODULE, label: "DSR" }], actionDispatcher: dispatcher },
  });
  await service.ready();
  // A notification scoped to `principal` (user scope) so `other` cannot see it.
  await query(
    `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope, audience_id, actions)
     VALUES ($1, $2, 'Dispatch test', 'body', 'normal', false, 'user', $3, $4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [NOTIFICATION_ID, MODULE, principal.userKey, JSON.stringify(ACTIONS)],
  );
});

afterAll(async () => {
  await query("DELETE FROM action_dispatches WHERE notification_id = $1", [NOTIFICATION_ID]);
  await query("DELETE FROM notification_reads WHERE notification_id = $1", [NOTIFICATION_ID]);
  await query("DELETE FROM notifications WHERE id = $1", [NOTIFICATION_ID]);
  await query("UPDATE modules SET base_url = NULL, enabled = true WHERE key = $1", [MODULE]);
  await query("UPDATE global_settings SET actions_enabled = true WHERE id = true");
  await pool.end();
});

// Reset to the "everything works" baseline before each test; each test then perturbs one dimension.
beforeEach(async () => {
  await service.setModuleEnabled(MODULE, true);
  await service.setModuleBaseUrl(MODULE, BASE_URL);
  await service.updateSettings({ actionsEnabled: true });
  vi.mocked(dispatcher.dispatch).mockReset();
  vi.mocked(dispatcher.dispatch).mockResolvedValue({
    status: 200,
    body: { ok: true, message: "Approved", resolve: true },
  });
});

afterEach(async () => {
  await query("DELETE FROM action_dispatches WHERE notification_id = $1", [NOTIFICATION_ID]);
  await query("DELETE FROM notification_reads WHERE notification_id = $1", [NOTIFICATION_ID]);
});

test("actionsEnabled off -> ActionsDisabledError, dispatcher NOT called", async () => {
  await service.updateSettings({ actionsEnabled: false });
  await expect(
    service.dispatchAction({
      principal,
      notificationId: NOTIFICATION_ID,
      actionRef: "0",
      idempotencyKey: "k1",
    }),
  ).rejects.toBeInstanceOf(ActionsDisabledError);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
});

test("module disabled -> ModuleUnavailableError", async () => {
  await service.setModuleEnabled(MODULE, false);
  await expect(
    service.dispatchAction({
      principal,
      notificationId: NOTIFICATION_ID,
      actionRef: "0",
      idempotencyKey: "k2",
    }),
  ).rejects.toBeInstanceOf(ModuleUnavailableError);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
});

test("base_url null -> ModuleUnavailableError", async () => {
  await service.setModuleBaseUrl(MODULE, null);
  await expect(
    service.dispatchAction({
      principal,
      notificationId: NOTIFICATION_ID,
      actionRef: "0",
      idempotencyKey: "k3",
    }),
  ).rejects.toBeInstanceOf(ModuleUnavailableError);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
});

test("notification not visible to principal -> NotFoundError", async () => {
  await expect(
    service.dispatchAction({
      principal: other,
      notificationId: NOTIFICATION_ID,
      actionRef: "0",
      idempotencyKey: "k4",
    }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
});

test("missing actionRef -> NotFoundError", async () => {
  await expect(
    service.dispatchAction({
      principal,
      notificationId: NOTIFICATION_ID,
      actionRef: "5",
      idempotencyKey: "k5",
    }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
});

test("a link action (non-dispatch) -> NotFoundError", async () => {
  await expect(
    service.dispatchAction({
      principal,
      notificationId: NOTIFICATION_ID,
      actionRef: "1",
      idempotencyKey: "k6",
    }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
});

test("happy path: composes url, records ok, applies resolve->markRead, returns message", async () => {
  const res = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k7",
  });
  expect(dispatcher.dispatch).toHaveBeenCalledWith({
    url: "http://localhost:4000/dsr/actions/approve",
    method: "POST",
    body: expect.objectContaining({
      notificationId: NOTIFICATION_ID,
      actionRef: "0",
      actor: { userKey: principal.userKey },
    }),
  });
  expect(res).toMatchObject({ ok: true, message: "Approved", resolve: true });

  // resolve=true applied markRead for this principal.
  const read = await query(
    "SELECT 1 FROM notification_reads WHERE user_key = $1 AND notification_id = $2",
    [principal.userKey, NOTIFICATION_ID],
  );
  expect(read.rowCount).toBe(1);
});

test("idempotent replay returns the recorded result WITHOUT calling the dispatcher again", async () => {
  await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k8",
  });
  vi.mocked(dispatcher.dispatch).mockClear();
  const again = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k8",
  });
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
  expect(again).toMatchObject({ ok: true, message: "Approved" });
});

test("dispatcher throws -> records failed, returns ok:false", async () => {
  vi.mocked(dispatcher.dispatch).mockRejectedValue(new Error("timeout"));
  const res = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k9",
  });
  expect(res).toMatchObject({ ok: false, message: "Action failed" });

  // The failed status is durable: a replay returns it without dispatching again.
  vi.mocked(dispatcher.dispatch).mockClear();
  const again = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k9",
  });
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
  expect(again.ok).toBe(false);
});

test("module response fails schema validation -> failed", async () => {
  vi.mocked(dispatcher.dispatch).mockResolvedValue({ status: 200, body: { nope: true } });
  const res = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k10",
  });
  expect(res).toMatchObject({ ok: false, message: "Action failed" });
});

test("non-2xx status -> failed even with a well-formed body", async () => {
  vi.mocked(dispatcher.dispatch).mockResolvedValue({
    status: 500,
    body: { ok: true, message: "ignored" },
  });
  const res = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k11",
  });
  expect(res).toMatchObject({ ok: false, message: "Action failed" });
});

test("module reports ok:false -> result ok:false with its message, no markRead", async () => {
  vi.mocked(dispatcher.dispatch).mockResolvedValue({
    status: 200,
    body: { ok: false, message: "Already handled", resolve: true },
  });
  const res = await service.dispatchAction({
    principal,
    notificationId: NOTIFICATION_ID,
    actionRef: "0",
    idempotencyKey: "k12",
  });
  expect(res).toMatchObject({ ok: false, message: "Already handled" });
  // resolve is only honored when ok is true.
  const read = await query(
    "SELECT 1 FROM notification_reads WHERE user_key = $1 AND notification_id = $2",
    [principal.userKey, NOTIFICATION_ID],
  );
  expect(read.rowCount).toBe(0);
});
