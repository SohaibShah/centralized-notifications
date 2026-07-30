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

// Auth adapter: roles come from a header so we can drive admin vs non-admin.
function fakeAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-test-user"];
  if (typeof userKey !== "string" || userKey === "") return null;
  const roles = ((req.headers["x-test-roles"] as string | undefined) ?? "")
    .split(",")
    .filter(Boolean);
  return { userKey, roles, teamKeys: [] };
}

const admin = { "x-test-user": "admin", "x-test-roles": "admin" };
const plain = { "x-test-user": "priya", "x-test-roles": "" };

const pool = testPool();
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
  // Restore the shared settings singleton.
  await svc.updateSettings({ aiSummaryEnabled: true });
  await app.close();
  await pool.end();
});

test("a non-admin is 403 on /admin/modules", async () => {
  const res = await app.inject({ method: "GET", url: "/admin/modules", headers: plain });
  expect(res.statusCode).toBe(403);
});

test("an admin lists modules including the configured catalog", async () => {
  const res = await app.inject({ method: "GET", url: "/admin/modules", headers: admin });
  expect(res.statusCode).toBe(200);
  const mods = res.json() as { key: string; label: string }[];
  expect(mods.find((m) => m.key === "dsr")?.label).toBe("DSR");
});

test("toggling a module persists via setModuleEnabled", async () => {
  const off = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { enabled: false },
  });
  expect(off.statusCode).toBe(204);
  const disabled = (
    await app.inject({ method: "GET", url: "/admin/modules", headers: admin })
  ).json() as {
    key: string;
    enabled: boolean;
  }[];
  expect(disabled.find((m) => m.key === "dsr")?.enabled).toBe(false);
  // Re-enable through the route and confirm via listModules.
  await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { enabled: true },
  });
  const mods = (
    await app.inject({ method: "GET", url: "/admin/modules", headers: admin })
  ).json() as {
    key: string;
    enabled: boolean;
  }[];
  expect(mods.find((m) => m.key === "dsr")?.enabled).toBe(true);
});

test("PATCH an unknown module → 404", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/not-a-module",
    headers: admin,
    payload: { enabled: false },
  });
  expect(res.statusCode).toBe(404);
});

test("PATCH /admin/modules/:key sets baseUrl", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { baseUrl: "http://localhost:4000/dsr" },
  });
  expect(res.statusCode).toBe(204);
  const mods = await svc.listModules();
  expect(mods.find((m) => m.id === "dsr")?.baseUrl).toBe("http://localhost:4000/dsr");
});

test("rejects a baseUrl that is not http(s) or null", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { baseUrl: "javascript:alert(1)" },
  });
  expect(res.statusCode).toBe(400);
});

test("PATCH /admin/modules/:key with empty body → 400", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: {},
  });
  expect(res.statusCode).toBe(400);
});

test("PATCH /admin/modules/:key clears baseUrl with null", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { baseUrl: null },
  });
  expect(res.statusCode).toBe(204);
  const mods = await svc.listModules();
  expect(mods.find((m) => m.id === "dsr")?.baseUrl).toBeNull();
});

test("GET /admin/modules includes each module's baseUrl", async () => {
  // Set one via the PATCH added above, then confirm the list read surfaces it.
  await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { baseUrl: "https://dsr.internal.example.com" },
  });
  const set = (
    await app.inject({ method: "GET", url: "/admin/modules", headers: admin })
  ).json() as { key: string; baseUrl: string | null }[];
  const dsr = set.find((m) => m.key === "dsr");
  expect(dsr).toBeDefined();
  expect(dsr?.baseUrl).toBe("https://dsr.internal.example.com");

  // And it reads back as null once cleared.
  await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: admin,
    payload: { baseUrl: null },
  });
  const cleared = (
    await app.inject({ method: "GET", url: "/admin/modules", headers: admin })
  ).json() as { key: string; baseUrl: string | null }[];
  expect(cleared.find((m) => m.key === "dsr")?.baseUrl).toBeNull();
});

test("settings round-trip: PATCH /admin/settings reflects in GET /settings/features", async () => {
  const patch = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: admin,
    payload: { aiSummaryEnabled: false },
  });
  expect(patch.statusCode).toBe(204);

  const features = await app.inject({ method: "GET", url: "/settings/features", headers: plain });
  expect(features.statusCode).toBe(200);
  expect((features.json() as { aiSummaryEnabled: boolean }).aiSummaryEnabled).toBe(false);
});

test("PATCH /admin/settings validates summaryTime and exposes it via GET /settings/features", async () => {
  const good = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: admin,
    payload: { summaryTime: "06:30" },
  });
  expect(good.statusCode).toBe(204);

  const bad = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: admin,
    payload: { summaryTime: "6:30pm" },
  });
  expect(bad.statusCode).toBe(400);

  const features = await app.inject({ method: "GET", url: "/settings/features", headers: plain });
  expect((features.json() as { summaryTime: string }).summaryTime).toBe("06:30");
});
