import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import {
  createNotificationService,
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

const notif = (id: string, audience: Notification["audience"]): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  priority: "high",
  snoozable: false,
  audience,
});

beforeAll(async () => {
  svc = createNotificationService({ pool, config: { modules: [{ id: "dsr", label: "DSR" }] } });
  await svc.ready();
  await svc.ingest(notif(globalId, { scope: "global" }));
  await svc.ingest(notif(teamId, { scope: "team", id: "eng" }));

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

test("marking read is audience-scoped: out-of-audience id → 404", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/notifications/${teamId}/read`,
    headers: { "x-test-user": "sam", "x-test-teams": "security" },
  });
  expect(res.statusCode).toBe(404);
});
