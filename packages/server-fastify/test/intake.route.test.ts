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

const TOKEN = "intake-secret";
const pool = testPool();
let app: FastifyInstance;
let svc: NotificationService;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fakeAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-test-user"];
  return typeof userKey === "string" && userKey !== ""
    ? { userKey, roles: [], teamKeys: [] }
    : null;
}

beforeAll(async () => {
  svc = createNotificationService({ pool, config: { modules: [{ id: "dsr", label: "DSR" }] } });
  await svc.ready();
  app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: fakeAuth,
    intakeAuth: (req) => req.headers["x-internal-token"] === TOKEN,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const payload = (id: string, module = "dsr") => ({
  id,
  module,
  title: id,
  description: "",
  priority: "high",
  snoozable: true,
  audience: { scope: "global" },
});

test("without the intake token → 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/internal/publish",
    payload: payload(`intake-noauth-${stamp}`),
  });
  expect(res.statusCode).toBe(401);
});

test("a valid payload is accepted and becomes visible in the feed", async () => {
  const id = `intake-ok-${stamp}`;
  const res = await app.inject({
    method: "POST",
    url: "/internal/publish",
    headers: { "x-internal-token": TOKEN },
    payload: payload(id),
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ accepted: 1 });

  const feed = await app.inject({
    method: "GET",
    url: "/notifications?limit=100",
    headers: { "x-test-user": "priya" },
  });
  expect((feed.json() as { items: { id: string }[] }).items.map((i) => i.id)).toContain(id);
});

test("a malformed item is reported invalid (per-item), not a 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/internal/publish",
    headers: { "x-internal-token": TOKEN },
    payload: { id: "x" }, // missing required fields
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ invalid: 1 });
});

test("a non-object body → 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/internal/publish",
    headers: { "x-internal-token": TOKEN, "content-type": "application/json" },
    payload: "42",
  });
  expect(res.statusCode).toBe(400);
});
