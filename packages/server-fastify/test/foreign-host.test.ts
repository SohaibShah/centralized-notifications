import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Audience, Notification } from "@notifications/shared";
import {
  createNotificationService,
  type NotificationService,
  type Principal,
} from "@notifications/core";
import { notificationFastifyPlugin } from "../src/index";
import { testPool } from "./harness";

// A completely NON-session identity model: the "host" carries identity in plain headers with no users
// table anywhere. If scoping is correct here, identity is genuinely injected, not owned. This is the
// dogfooding proof the extraction exists for.
function headerAuth(req: FastifyRequest): Principal | null {
  const userKey = req.headers["x-fake-user"];
  if (typeof userKey !== "string" || userKey === "") return null;
  const split = (h: string): string[] =>
    ((req.headers[h] as string | undefined) ?? "").split(",").filter(Boolean);
  return { userKey, roles: split("x-fake-roles"), teamKeys: split("x-fake-teams") };
}

const pool = testPool();
let app: FastifyInstance;
let svc: NotificationService;
const s = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// One notification per audience shape, tagged with our stamp so we can filter the shared feed.
const seeds: { id: string; audience: Audience }[] = [
  { id: `fh-global-${s}`, audience: { scope: "global" } },
  { id: `fh-team-eng-${s}`, audience: { scope: "team", id: "eng" } },
  { id: `fh-team-ops-${s}`, audience: { scope: "team", id: "ops" } },
  { id: `fh-role-admin-${s}`, audience: { scope: "role", id: "admin" } },
  { id: `fh-role-viewer-${s}`, audience: { scope: "role", id: "viewer" } },
  { id: `fh-user-alice-${s}`, audience: { scope: "user", id: "alice" } },
  { id: `fh-user-bob-${s}`, audience: { scope: "user", id: "bob" } },
];

const notif = (id: string, audience: Audience): Notification => ({
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
  for (const { id, audience } of seeds) await svc.ingest(notif(id, audience));
  app = Fastify({ maxParamLength: 256 });
  await app.register(notificationFastifyPlugin, {
    service: svc,
    auth: headerAuth,
    intakeAuth: () => true,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function visibleIds(headers: Record<string, string>): Promise<Set<string>> {
  const res = await app.inject({ method: "GET", url: "/notifications?limit=100", headers });
  expect(res.statusCode).toBe(200);
  const mine = (res.json() as { items: { id: string }[] }).items
    .map((i) => i.id)
    .filter((id) => id.endsWith(s));
  return new Set(mine);
}

const cases: { name: string; headers: Record<string, string>; expect: string[] }[] = [
  {
    name: "alice (admin, eng)",
    headers: { "x-fake-user": "alice", "x-fake-roles": "admin", "x-fake-teams": "eng" },
    expect: [`fh-global-${s}`, `fh-team-eng-${s}`, `fh-role-admin-${s}`, `fh-user-alice-${s}`],
  },
  {
    name: "bob (ops)",
    headers: { "x-fake-user": "bob", "x-fake-teams": "ops" },
    expect: [`fh-global-${s}`, `fh-team-ops-${s}`, `fh-user-bob-${s}`],
  },
  {
    name: "carol (viewer)",
    headers: { "x-fake-user": "carol", "x-fake-roles": "viewer" },
    expect: [`fh-global-${s}`, `fh-role-viewer-${s}`],
  },
  {
    name: "dave (no roles/teams)",
    headers: { "x-fake-user": "dave" },
    expect: [`fh-global-${s}`],
  },
];

for (const c of cases) {
  test(`${c.name} sees exactly their audience`, async () => {
    expect(await visibleIds(c.headers)).toEqual(new Set(c.expect));
  });
}

test("marking read an out-of-audience id returns 404 (no existence oracle)", async () => {
  // dave (global only) tries to mark bob's user-scoped notification read.
  const res = await app.inject({
    method: "POST",
    url: `/notifications/fh-user-bob-${s}/read`,
    headers: { "x-fake-user": "dave" },
  });
  expect(res.statusCode).toBe(404);
});
