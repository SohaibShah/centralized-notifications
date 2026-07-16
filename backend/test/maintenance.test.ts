import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { ingest } from "../src/pipeline/ingest";
import { invalidatePolicyCache } from "../src/pipeline/policy";
import { buildServer } from "../src/server";

const PW = "maint-test-pass";

describe("POST /admin/maintenance", () => {
  let app: FastifyInstance;

  async function login(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: PW },
    });
    const raw = res.headers["set-cookie"];
    const c = Array.isArray(raw) ? raw[0] : raw;
    return (c ?? "").split(";")[0] ?? "";
  }

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM users WHERE username IN ('m_admin', 'm_plain')");
    await query(
      "INSERT INTO roles (key, label) VALUES ('admin', 'Administrator') ON CONFLICT (key) DO NOTHING",
    );
    const hash = await hashPassword(PW);
    const admin = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('m_admin','M Admin',$1) RETURNING id",
      [hash],
    );
    await query("INSERT INTO user_roles (user_id, role_key) VALUES ($1,'admin')", [
      admin.rows[0]!.id,
    ]);
    await query(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('m_plain','M Plain',$1)",
      [hash],
    );
    invalidatePolicyCache();
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("delete-all removes every notification and requires admin", async () => {
    await ingest({
      id: `maint-${Date.now()}-1`,
      module: "maint",
      title: "a",
      description: "",
      priority: "low",
      snoozable: true,
      audience: { scope: "global" },
    });
    const anon = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-all",
    });
    expect(anon.statusCode).toBe(401);
    const plain = await login("m_plain");
    const forbidden = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-all",
      headers: { cookie: plain },
    });
    expect(forbidden.statusCode).toBe(403);
    const cookie = await login("m_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-all",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
    const count = await query<{ c: string }>("SELECT count(*) AS c FROM notifications");
    expect(Number(count.rows[0]!.c)).toBe(0);
  });

  it("delete-older-than validates days and deletes by age", async () => {
    const cookie = await login("m_admin");
    const bad = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-older-than",
      headers: { cookie },
      payload: { days: 0 },
    });
    expect(bad.statusCode).toBe(400);

    const id = `old-${Date.now()}`;
    await ingest({
      id,
      module: "maint",
      title: "old",
      description: "",
      priority: "low",
      snoozable: true,
      audience: { scope: "global" },
    });
    await query("UPDATE notifications SET created_at = now() - interval '10 days' WHERE id = $1", [
      id,
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-older-than",
      headers: { cookie },
      payload: { days: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
    expect((await query("SELECT 1 FROM notifications WHERE id = $1", [id])).rowCount).toBe(0);
  });

  it("delete-read removes notifications that have been read", async () => {
    const cookie = await login("m_admin");
    const admin = await query<{ id: string }>("SELECT id FROM users WHERE username = 'm_admin'");
    const id = `read-${Date.now()}`;
    await ingest({
      id,
      module: "maint",
      title: "read",
      description: "",
      priority: "low",
      snoozable: true,
      audience: { scope: "global" },
    });
    await query("INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)", [
      admin.rows[0]!.id,
      id,
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/admin/maintenance/notifications/delete-read",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
    expect((await query("SELECT 1 FROM notifications WHERE id = $1", [id])).rowCount).toBe(0);
  });

  it("modules/reset clears discovered modules; settings/reset restores defaults", async () => {
    const cookie = await login("m_admin");
    await query(
      "INSERT INTO modules (key, label, enabled) VALUES ('maint-mod','Maint',false) ON CONFLICT (key) DO NOTHING",
    );
    const rm = await app.inject({
      method: "POST",
      url: "/admin/maintenance/modules/reset",
      headers: { cookie },
    });
    expect(rm.statusCode).toBe(200);
    expect((await query("SELECT 1 FROM modules")).rowCount).toBe(0);

    await query(
      "UPDATE global_settings SET ai_summary_enabled = false, retention_days = 99 WHERE id = true",
    );
    const rs = await app.inject({
      method: "POST",
      url: "/admin/maintenance/settings/reset",
      headers: { cookie },
    });
    expect(rs.statusCode).toBe(200);
    const s = await query<{ ai_summary_enabled: boolean; retention_days: number }>(
      "SELECT ai_summary_enabled, retention_days FROM global_settings WHERE id = true",
    );
    expect(s.rows[0]!.ai_summary_enabled).toBe(true);
    expect(s.rows[0]!.retention_days).toBe(30);
  });
});
