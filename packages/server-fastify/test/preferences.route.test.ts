import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createNotificationService,
  type NotificationService,
  type Principal,
} from "@notifications/core";
import { notificationFastifyPlugin } from "../src/index";
import { testPool } from "./harness";

function fakeAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-test-user"];
  return typeof userKey === "string" && userKey !== ""
    ? { userKey, roles: [], teamKeys: [] }
    : null;
}

const pool = testPool();
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const user = () => `pref-route-${stamp}`;
let app: FastifyInstance;
let svc: NotificationService;

beforeAll(async () => {
  svc = createNotificationService({ pool, config: { modules: [{ id: "dsr", label: "DSR" }] } });
  await svc.ready();
  app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: fakeAuth,
    intakeAuth: () => true,
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const asUser = (u: string) => ({ "x-test-user": u });

test("GET /notifications/modules returns the id+label catalog for any user", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications/modules",
    headers: asUser(user()),
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toContainEqual({ id: "dsr", label: "DSR" });
});

test("GET returns defaults and an empty rule list for a fresh user", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/notifications/preferences",
    headers: asUser(user()),
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    groupingEnabled: true,
    summaryOptOut: false,
    toastMinPriority: "critical",
    rules: [],
  });
});

test("PATCH updates a scalar and returns the merged preferences", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/notifications/preferences",
    headers: asUser(user()),
    payload: { toastMinPriority: "off" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ toastMinPriority: "off" });
});

test("PATCH with an empty body is 400", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/notifications/preferences",
    headers: asUser(user()),
    payload: {},
  });
  expect(res.statusCode).toBe(400);
});

test("POST a module mute then GET reflects it; DELETE removes it", async () => {
  const u = `pref-mute-${stamp}`;
  const put = await app.inject({
    method: "POST",
    url: "/notifications/mutes/module/dsr",
    headers: asUser(u),
    payload: { until: null },
  });
  expect(put.statusCode).toBe(204);

  const get = await app.inject({
    method: "GET",
    url: "/notifications/preferences",
    headers: asUser(u),
  });
  expect(get.json().rules).toContainEqual({
    targetKind: "module",
    target: "dsr",
    mutedUntil: null,
  });

  const del = await app.inject({
    method: "DELETE",
    url: "/notifications/mutes/module/dsr",
    headers: asUser(u),
  });
  expect(del.statusCode).toBe(204);
  const after = await app.inject({
    method: "GET",
    url: "/notifications/preferences",
    headers: asUser(u),
  });
  expect(after.json().rules).toEqual([]);
});

test("POST a category snooze with a future time succeeds", async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const res = await app.inject({
    method: "POST",
    url: "/notifications/mutes/category/marketing",
    headers: asUser(`pref-cat-${stamp}`),
    payload: { until: future },
  });
  expect(res.statusCode).toBe(204);
});

test("POST rejects an unknown kind, an unknown module, and a past until", async () => {
  const u = user();
  const badKind = await app.inject({
    method: "POST",
    url: "/notifications/mutes/team/eng",
    headers: asUser(u),
    payload: { until: null },
  });
  expect(badKind.statusCode).toBe(400);

  const badModule = await app.inject({
    method: "POST",
    url: "/notifications/mutes/module/does-not-exist",
    headers: asUser(u),
    payload: { until: null },
  });
  expect(badModule.statusCode).toBe(400);

  const past = new Date(Date.now() - 1000).toISOString();
  const badTime = await app.inject({
    method: "POST",
    url: "/notifications/mutes/module/dsr",
    headers: asUser(u),
    payload: { until: past },
  });
  expect(badTime.statusCode).toBe(400);
});

test("all preference endpoints are 401 without auth", async () => {
  for (const [method, url] of [
    ["GET", "/notifications/preferences"],
    ["PATCH", "/notifications/preferences"],
    ["POST", "/notifications/mutes/module/dsr"],
    ["DELETE", "/notifications/mutes/module/dsr"],
  ] as const) {
    const res = await app.inject({ method, url, payload: method === "GET" ? undefined : {} });
    expect(res.statusCode).toBe(401);
  }
});
