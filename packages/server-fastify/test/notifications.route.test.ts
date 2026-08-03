import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Notification } from "@notifications/shared";
import {
  createNotificationService,
  type ActionDispatcher,
  type NotificationService,
  type Principal,
} from "@notifications/core";
import { notificationFastifyPlugin } from "../src/index";
import { testPool } from "./harness";

// A FAKE auth adapter driven by headers — NO session, NO users table. Proves the plugin scopes
// correctly for ANY host identity model.
function fakeAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-test-user"];
  if (typeof userKey !== "string" || userKey === "") return null;
  const teams = (req.headers["x-test-teams"] as string | undefined) ?? "";
  return { userKey, roles: [], teamKeys: teams.split(",").filter(Boolean) };
}

const pool = testPool();
let app: FastifyInstance;
let svc: NotificationService;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const globalId = `route-global-${stamp}`;
const teamId = `route-team-${stamp}`;
const actionId = `route-action-${stamp}`;

const notif = (id: string, audience: Notification["audience"]): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  priority: "high",
  snoozable: false,
  audience,
});

// Fake outbound transport for `dispatch` actions — injected the same way core's own
// action-dispatch tests do it, so the route can be driven through every branch without a real
// module server.
const dispatcher: ActionDispatcher = { dispatch: vi.fn() };

beforeAll(async () => {
  svc = createNotificationService({
    pool,
    config: { modules: [{ id: "dsr", label: "DSR" }], actionDispatcher: dispatcher },
  });
  await svc.ready();
  await svc.ingest(notif(globalId, { scope: "global" }));
  await svc.ingest(notif(teamId, { scope: "team", id: "eng" }));
  await svc.ingest({
    ...notif(actionId, { scope: "global" }),
    actions: [{ label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" }],
  });

  app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: fakeAuth,
    intakeAuth: () => true,
  });
  await app.ready();
});

afterAll(async () => {
  // Restore the shared module/settings singletons for any test file that runs after this one.
  await svc.setModuleBaseUrl("dsr", null);
  await svc.updateSettings({ actionsEnabled: true });
  await app.close();
  await pool.end();
});

async function feedIds(headers: Record<string, string>): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: "/notifications?limit=100", headers });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
}

test("a team member sees the global + their team notification", async () => {
  const ids = await feedIds({ "x-test-user": "priya", "x-test-teams": "eng" });
  expect(ids).toContain(globalId);
  expect(ids).toContain(teamId);
});

test("a non-member sees the global but not the team notification", async () => {
  const ids = await feedIds({ "x-test-user": "sam", "x-test-teams": "security" });
  expect(ids).toContain(globalId);
  expect(ids).not.toContain(teamId);
});

test("missing auth → 401", async () => {
  const res = await app.inject({ method: "GET", url: "/notifications" });
  expect(res.statusCode).toBe(401);
});

test("a bad cursor → 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications?cursor=not-a-real-cursor",
    headers: { "x-test-user": "priya" },
  });
  expect(res.statusCode).toBe(400);
});

test("view=muted returns only what an active rule hides; active view is the inverse", async () => {
  const mutedUser = `route-muted-${stamp}`;
  const headers = { "x-test-user": mutedUser };
  const snoozableId = `route-snoozable-${stamp}`;
  // A snoozable global notif; `globalId` (ingested in beforeAll) is non-snoozable.
  await svc.ingest({ ...notif(snoozableId, { scope: "global" }), snoozable: true });
  await svc.putMuteRule({
    principal: { userKey: mutedUser, roles: [], teamKeys: [] },
    targetKind: "module",
    target: "dsr",
    until: null,
  });

  const muted = await app.inject({
    method: "GET",
    url: "/notifications?view=muted&limit=100",
    headers,
  });
  expect(muted.statusCode).toBe(200);
  const mutedIds = (muted.json() as { items: { id: string }[] }).items.map((i) => i.id);
  expect(mutedIds).toContain(snoozableId); // snoozable + muted module → in the muted view
  expect(mutedIds).not.toContain(globalId); // non-snoozable → never muted

  const active = await feedIds(headers);
  expect(active).not.toContain(snoozableId); // hidden from the active feed
  expect(active).toContain(globalId); // still comes through
});

test("grouped=true returns collapsed entries with per-group totals", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications?grouped=true&limit=100",
    headers: { "x-test-user": "priya", "x-test-teams": "eng" },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { entries: { groupTotal: number; topPriority: string }[] };
  expect(Array.isArray(body.entries)).toBe(true);
  expect(body.entries.length).toBeGreaterThan(0);
  // Every collapsed entry carries the per-group aggregates.
  for (const e of body.entries) {
    expect(typeof e.groupTotal).toBe("number");
    expect(e.groupTotal).toBeGreaterThanOrEqual(1);
    expect(typeof e.topPriority).toBe("string");
  }
});

test("grouped=true honors a sort and returns collapsed entries", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications?grouped=true&sort=priority-high&limit=100",
    headers: { "x-test-user": "priya", "x-test-teams": "eng" },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { entries: { topPriority: string }[] };
  expect(body.entries.length).toBeGreaterThan(0);
  // priority-high orders by severity: no entry after the first may be strictly more severe than it.
  const rank: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  const ranks = body.entries.map((e) => rank[e.topPriority] ?? 9);
  expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
});

test("grouped + group together → 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications?grouped=true&group=dsr:x",
    headers: { "x-test-user": "priya" },
  });
  expect(res.statusCode).toBe(400);
});

test("an invalid view value → 400", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications?view=bogus",
    headers: { "x-test-user": "priya" },
  });
  expect(res.statusCode).toBe(400);
});

test("marking read is audience-scoped: out-of-audience id → 404", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${teamId}/read`,
    headers: { "x-test-user": "sam", "x-test-teams": "security" },
  });
  expect(res.statusCode).toBe(404);
});

test("POST /notifications/read with { group } marks the whole group read", async () => {
  const gUser = { "x-test-user": `route-grpread-${stamp}` };
  const key = `grpread-${stamp}`;
  await svc.ingest({ ...notif(`gr-a-${stamp}`, { scope: "global" }), metadata: { groupKey: key } });
  await svc.ingest({ ...notif(`gr-b-${stamp}`, { scope: "global" }), metadata: { groupKey: key } });

  const res = await app.inject({
    method: "POST",
    url: "/notifications/read",
    headers: gUser,
    payload: { group: `dsr:${key}` },
  });
  expect(res.statusCode).toBe(204);

  const feed = await app.inject({ method: "GET", url: "/notifications?limit=100", headers: gUser });
  const items = (feed.json() as { items: { id: string; read: boolean }[] }).items;
  const mine = items.filter((i) => i.id.startsWith("gr-"));
  expect(mine.length).toBeGreaterThanOrEqual(2);
  expect(mine.every((i) => i.read)).toBe(true);
});

test("GET /notifications?group&read scopes a drill-in to one read-state", async () => {
  const u = { "x-test-user": `route-rdscope-${stamp}` };
  const key = `rdscope-${stamp}`;
  const unreadId = `rd-unread-${stamp}`;
  const readId = `rd-read-${stamp}`;
  await svc.ingest({ ...notif(unreadId, { scope: "global" }), metadata: { groupKey: key } });
  await svc.ingest({ ...notif(readId, { scope: "global" }), metadata: { groupKey: key } });
  await svc.markRead({
    principal: { userKey: u["x-test-user"], roles: [], teamKeys: [] },
    id: readId,
  });

  const res = await app.inject({
    method: "GET",
    url: `/notifications?group=dsr:${key}&read=false&limit=100`,
    headers: u,
  });
  expect(res.statusCode).toBe(200);
  const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
  expect(ids).toContain(unreadId);
  expect(ids).not.toContain(readId);
});

test("POST /notifications/read with neither ids nor group → 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/notifications/read",
    headers: { "x-test-user": "priya" },
    payload: {},
  });
  expect(res.statusCode).toBe(400);
});

test("POST /notifications/read with both ids and group → 400 (exactly one)", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/notifications/read",
    headers: { "x-test-user": "priya" },
    payload: { ids: ["x"], group: "dsr:y" },
  });
  expect(res.statusCode).toBe(400);
});

const dispatchUser = { "x-test-user": `dispatch-caller-${stamp}` };

test("dispatch action: 401 without a principal", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${actionId}/actions/0/dispatch`,
    payload: { idempotencyKey: "k-noauth" },
  });
  expect(res.statusCode).toBe(401);
});

test("dispatch action: missing idempotencyKey → 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${actionId}/actions/0/dispatch`,
    headers: dispatchUser,
    payload: {},
  });
  expect(res.statusCode).toBe(400);
});

test("dispatch action: non-numeric ref → 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${actionId}/actions/abc/dispatch`,
    headers: dispatchUser,
    payload: { idempotencyKey: "k-badref" },
  });
  expect(res.statusCode).toBe(400);
});

test("dispatch action: actionsEnabled off → 403", async () => {
  await svc.updateSettings({ actionsEnabled: false });
  try {
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${actionId}/actions/0/dispatch`,
      headers: dispatchUser,
      payload: { idempotencyKey: "k-disabled" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "actions disabled" });
  } finally {
    await svc.updateSettings({ actionsEnabled: true });
  }
});

test("dispatch action: module has no base_url → 409", async () => {
  // No base_url has been configured for "dsr" at this point (default / reset by afterAll of
  // earlier-running suites) — the module is known + enabled but unreachable.
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${actionId}/actions/0/dispatch`,
    headers: dispatchUser,
    payload: { idempotencyKey: "k-unavailable" },
  });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ error: "module unavailable" });
});

test("dispatch action: unknown action ref → 404", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${actionId}/actions/5/dispatch`,
    headers: dispatchUser,
    payload: { idempotencyKey: "k-noref" },
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ error: "notification or action not found" });
});

test("dispatch action: 200 returns the dispatch result and calls the service correctly", async () => {
  vi.mocked(dispatcher.dispatch).mockResolvedValue({
    status: 200,
    body: { ok: true, message: "Approved", resolve: true },
  });
  await svc.setModuleBaseUrl("dsr", "http://localhost:4000/dsr");
  try {
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${actionId}/actions/0/dispatch`,
      headers: dispatchUser,
      payload: { idempotencyKey: "k-happy" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, message: "Approved", resolve: true });
    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      url: "http://localhost:4000/dsr/actions/approve",
      method: "POST",
      body: expect.objectContaining({ notificationId: actionId, actionRef: "0" }),
    });
  } finally {
    await svc.setModuleBaseUrl("dsr", null);
  }
});
