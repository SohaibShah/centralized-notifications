import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import {
  createNotificationService,
  type AiProvider,
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

async function buildApp(
  provider?: AiProvider,
): Promise<{ app: FastifyInstance; svc: NotificationService }> {
  const svc = createNotificationService({
    pool,
    config: { modules: [{ id: "dsr", label: "DSR" }], ...(provider ? { ai: { provider } } : {}) },
  });
  await svc.ready();
  const app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: fakeAuth,
    intakeAuth: () => true,
  });
  await app.ready();
  return { app, svc };
}

// Seed one unread user-scoped notification so a refresh has a non-empty set for `user`.
async function seedUnread(svc: NotificationService, user: string): Promise<void> {
  const n: Notification = {
    id: `sumroute-${user}-${stamp}`,
    module: "dsr",
    title: "t",
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: user },
  };
  await svc.ingest(n);
}

let ok: { app: FastifyInstance; svc: NotificationService };
beforeAll(async () => {
  ok = await buildApp({ complete: async () => "FAKE SUMMARY" });
  // Sibling files seed GLOBAL-scoped notifications into this shared plugin test DB (migrated once
  // per run, not per file); globals are visible to every principal, which would inflate `basedOn`
  // and break the caught-up (0) assertion depending on file order. Clear them for determinism.
  await pool.query("DELETE FROM notifications WHERE audience_scope = 'global'");
  await seedUnread(ok.svc, "sumuser");
  // A sibling file may leave aiSummaryEnabled=false on the shared singleton; set it back so this
  // file starts enabled (PolicyStore caches per-instance and only its own writes invalidate).
  await ok.svc.updateSettings({ aiSummaryEnabled: true });
});
afterAll(async () => {
  await ok.app.close();
  await ok.svc.updateSettings({ aiSummaryEnabled: true }); // restore shared singleton
  await pool.end();
});

test("GET returns the stored null-shape for a user with no summary yet", async () => {
  const res = await ok.app.inject({
    method: "GET",
    url: "/notifications/summary",
    headers: { "x-test-user": `sumread-${stamp}` },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ summary: null, basedOn: 0, generatedAt: null });
});

test("GET is 401 without auth", async () => {
  const res = await ok.app.inject({ method: "GET", url: "/notifications/summary" });
  expect(res.statusCode).toBe(401);
});

test("POST /refresh generates + persists; GET then reads it back", async () => {
  const refresh = await ok.app.inject({
    method: "POST",
    url: "/notifications/summary/refresh",
    headers: { "x-test-user": "sumuser" },
  });
  expect(refresh.statusCode).toBe(200);
  const body = refresh.json() as { summary: string; basedOn: number; generatedAt: string };
  expect(body).toMatchObject({ summary: "FAKE SUMMARY", basedOn: 1 });
  expect(typeof body.generatedAt).toBe("string");

  const get = await ok.app.inject({
    method: "GET",
    url: "/notifications/summary",
    headers: { "x-test-user": "sumuser" },
  });
  expect(get.json()).toEqual(body);
});

test("POST /refresh is 401 without auth", async () => {
  const res = await ok.app.inject({ method: "POST", url: "/notifications/summary/refresh" });
  expect(res.statusCode).toBe(401);
});

test("POST /refresh is 404 when aiSummaryEnabled is false", async () => {
  await ok.svc.updateSettings({ aiSummaryEnabled: false });
  try {
    const res = await ok.app.inject({
      method: "POST",
      url: "/notifications/summary/refresh",
      headers: { "x-test-user": "sumuser" },
    });
    expect(res.statusCode).toBe(404);
  } finally {
    await ok.svc.updateSettings({ aiSummaryEnabled: true });
  }
});

test("POST /refresh is 501 when no provider is configured", async () => {
  const { app, svc } = await buildApp(); // no ai provider
  await seedUnread(svc, "noprov");
  const res = await app.inject({
    method: "POST",
    url: "/notifications/summary/refresh",
    headers: { "x-test-user": "noprov" },
  });
  expect(res.statusCode).toBe(501);
  await app.close();
});

test("POST /refresh is 502 when the provider throws", async () => {
  const { app, svc } = await buildApp({
    complete: async () => {
      throw new Error("model down");
    },
  });
  await seedUnread(svc, "proverr");
  const res = await app.inject({
    method: "POST",
    url: "/notifications/summary/refresh",
    headers: { "x-test-user": "proverr" },
  });
  expect(res.statusCode).toBe(502);
  await app.close();
});
