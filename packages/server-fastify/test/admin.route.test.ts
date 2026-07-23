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
