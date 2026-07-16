import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password";
import { loadEnv } from "../src/config/env";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { invalidatePolicyCache } from "../src/pipeline/policy";
import { buildServer, isSimulatorEnabled } from "../src/server";

const PW = "sim-test-pass";

describe("isSimulatorEnabled", () => {
  const base = {
    DATABASE_URL: "postgres://x",
    SESSION_SECRET: "a".repeat(64),
    INTERNAL_INTAKE_TOKEN: "0123456789abcdef",
  };
  it("is false in production, true otherwise", () => {
    expect(isSimulatorEnabled(loadEnv({ ...base, NODE_ENV: "production" }))).toBe(false);
    expect(isSimulatorEnabled(loadEnv({ ...base, NODE_ENV: "development" }))).toBe(true);
    expect(isSimulatorEnabled(loadEnv({ ...base, NODE_ENV: "test" }))).toBe(true);
  });
});

describe("POST /admin/simulate", () => {
  let app: FastifyInstance;

  async function login(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: PW },
    });
    expect(res.statusCode).toBe(200);
    const raw = res.headers["set-cookie"];
    const c = Array.isArray(raw) ? raw[0] : raw;
    return (c ?? "").split(";")[0] ?? "";
  }

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM notifications WHERE id LIKE 'sim-%' OR module = 'sim-disabled'");
    await query("DELETE FROM modules WHERE key = 'sim-disabled'");
    await query("DELETE FROM users WHERE username IN ('sim_admin', 'sim_plain')");
    await query(
      "INSERT INTO roles (key, label) VALUES ('admin', 'Administrator') ON CONFLICT (key) DO NOTHING",
    );
    const hash = await hashPassword(PW);
    const admin = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('sim_admin', 'Sim Admin', $1) RETURNING id",
      [hash],
    );
    await query("INSERT INTO user_roles (user_id, role_key) VALUES ($1, 'admin')", [
      admin.rows[0]!.id,
    ]);
    await query(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('sim_plain', 'Sim Plain', $1)",
      [hash],
    );
    // A disabled module so a custom publish to it comes back suppressed.
    await query(
      "INSERT INTO modules (key, label, enabled) VALUES ('sim-disabled', 'Sim Disabled', false)",
    );
    invalidatePolicyCache();
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("401 without a session, 403 for a non-admin", async () => {
    const anon = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      payload: { mode: "preset", preset: "normal-finding" },
    });
    expect(anon.statusCode).toBe(401);
    const plain = await login("sim_plain");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie: plain },
      payload: { mode: "preset", preset: "normal-finding" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("custom mode publishes one, with a server-assigned sim- id, and returns published:1", async () => {
    const cookie = await login("sim_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: {
        mode: "custom",
        sampleActions: 2,
        notification: {
          id: "CLIENT-SHOULD-BE-IGNORED",
          module: "sim-custom",
          title: "Custom one",
          description: "",
          priority: "high",
          snoozable: true,
          audience: { scope: "global" },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ published: 1, suppressed: 0 });
    const list = await app.inject({
      method: "GET",
      url: "/notifications?limit=50",
      headers: { cookie },
    });
    const items = list.json().items as { id: string; module: string; actions?: unknown[] }[];
    const mine = items.find((n) => n.module === "sim-custom");
    expect(mine?.id.startsWith("sim-")).toBe(true);
    expect(mine?.actions).toHaveLength(2);
  });

  it("a custom publish to a disabled module is suppressed and absent from the feed", async () => {
    const cookie = await login("sim_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: {
        mode: "custom",
        notification: {
          module: "sim-disabled",
          title: "Nope",
          description: "",
          priority: "low",
          snoozable: true,
          audience: { scope: "global" },
        },
      },
    });
    expect(res.json()).toEqual({ published: 0, suppressed: 1 });
    const list = await app.inject({
      method: "GET",
      url: "/notifications?limit=100",
      headers: { cookie },
    });
    const items = list.json().items as { module: string }[];
    expect(items.some((n) => n.module === "sim-disabled")).toBe(false);
  });

  it("burst mode publishes N (published + suppressed == N)", async () => {
    const cookie = await login("sim_admin");
    // No fixed seed: simulate()'s ids are then time-based and unique per run, so a rerun
    // doesn't see the previous run's notifications as duplicates.
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "burst", count: 12 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { published: number; suppressed: number };
    expect(body.published + body.suppressed).toBe(12);
  });

  it("re-running the same seeded burst still publishes N (server-unique ids, no self-dedupe)", async () => {
    const cookie = await login("sim_admin");
    const publish = () =>
      app.inject({
        method: "POST",
        url: "/admin/simulate",
        headers: { cookie },
        payload: { mode: "burst", count: 6, seed: 42 },
      });
    const first = (await publish()).json() as { published: number; suppressed: number };
    const second = (await publish()).json() as { published: number; suppressed: number };
    expect(first.published + first.suppressed).toBe(6);
    expect(second.published + second.suppressed).toBe(6);
  });

  it("rejects a bad body, a non-positive count, and an over-ceiling count with 400", async () => {
    const cookie = await login("sim_admin");
    const bad = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "custom", notification: { title: "no module" } },
    });
    expect(bad.statusCode).toBe(400);
    const zero = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "burst", count: 0 },
    });
    expect(zero.statusCode).toBe(400);
    const huge = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "burst", count: 10_000_000 },
    });
    expect(huge.statusCode).toBe(400);
  });
});
