import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { ingest } from "../src/pipeline/ingest";
import { invalidatePolicyCache } from "../src/pipeline/policy";
import { buildServer } from "../src/server";

beforeAll(async () => {
  await migrate();
});
afterAll(async () => {
  await closePool();
});

describe("admin schema (migration 005)", () => {
  it("creates the modules and global_settings tables and the suppressed column", async () => {
    await query(
      "INSERT INTO modules (key, label) VALUES ('smoke', 'Smoke') ON CONFLICT (key) DO NOTHING",
    );
    const mod = await query<{ enabled: boolean }>(
      "SELECT enabled FROM modules WHERE key = 'smoke'",
    );
    expect(mod.rows[0]?.enabled).toBe(true);

    const settings = await query<{ ai_summary_enabled: boolean }>(
      "SELECT ai_summary_enabled FROM global_settings WHERE id = true",
    );
    expect(settings.rows[0]?.ai_summary_enabled).toBe(true);

    const col = await query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'suppressed'",
    );
    expect(col.rowCount).toBe(1);
  });

  it("enforces the global_settings singleton", async () => {
    await expect(query("INSERT INTO global_settings (id) VALUES (false)")).rejects.toThrow();
  });
});

describe("admin API", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let userCookie: string;
  const PW = "admin-test-pass";

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
    // Clean slate for this suite's fixtures.
    await query("DELETE FROM notifications WHERE module = 'admin-dsar'");
    await query("DELETE FROM modules WHERE key = 'admin-dsar'");
    await query("DELETE FROM users WHERE username IN ('t_admin', 't_plain')");
    await query(
      "INSERT INTO roles (key, label) VALUES ('admin', 'Administrator') ON CONFLICT (key) DO NOTHING",
    );

    const hash = await hashPassword(PW);
    const admin = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('t_admin', 'T Admin', $1) RETURNING id",
      [hash],
    );
    await query("INSERT INTO user_roles (user_id, role_key) VALUES ($1, 'admin')", [
      admin.rows[0]!.id,
    ]);
    await query(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('t_plain', 'T Plain', $1)",
      [hash],
    );

    // A discovered module with a mixed-priority history, including one suppressed row.
    await query(
      "INSERT INTO modules (key, label, enabled) VALUES ('admin-dsar', 'Admin Dsar', true)",
    );
    const seed = [
      { id: "admin-dsar-1", priority: "critical", suppressed: false },
      { id: "admin-dsar-2", priority: "high", suppressed: false },
      { id: "admin-dsar-3", priority: "low", suppressed: true },
    ];
    for (const s of seed) {
      await query(
        `INSERT INTO notifications
           (id, module, title, description, priority, snoozable, audience_scope, suppressed)
         VALUES ($1, 'admin-dsar', 'seed', '', $2, true, 'global', $3)`,
        [s.id, s.priority, s.suppressed],
      );
    }

    app = await buildServer();
    adminCookie = await login("t_admin");
    userCookie = await login("t_plain");
  });

  it("blocks non-admins from /admin/modules (403) and unauthenticated (401)", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/modules" })).statusCode).toBe(401);
    const res = await app.inject({
      method: "GET",
      url: "/admin/modules",
      headers: { cookie: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists modules with a priority breakdown, totals, and suppressed count", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/modules",
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const mods = res.json() as {
      key: string;
      total: number;
      suppressed: number;
      byPriority: { critical: number; high: number; low: number };
    }[];
    const m = mods.find((x) => x.key === "admin-dsar")!;
    expect(m.total).toBe(3);
    expect(m.suppressed).toBe(1);
    expect(m.byPriority.critical).toBe(1);
    expect(m.byPriority.high).toBe(1);
  });

  it("disables a module (PATCH) and it takes effect on the next ingest", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/modules/admin-dsar",
      headers: { cookie: adminCookie },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(204);

    const id = `admin-after-off-${Date.now()}`;
    const ing = await ingest({
      id,
      module: "admin-dsar",
      title: "x",
      description: "",
      priority: "low",
      snoozable: true,
      audience: { scope: "global" },
    });
    expect(ing.status).toBe("accepted");
    const row = await query<{ suppressed: boolean }>(
      "SELECT suppressed FROM notifications WHERE id = $1",
      [id],
    );
    expect(row.rows[0]?.suppressed).toBe(true);

    // Re-enable for later assertions and invalidate the shared cache.
    await app.inject({
      method: "PATCH",
      url: "/admin/modules/admin-dsar",
      headers: { cookie: adminCookie },
      payload: { enabled: true },
    });
  });

  it("ignores a label-only body (label is no longer editable) with 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/modules/admin-dsar",
      headers: { cookie: adminCookie },
      payload: { label: "Renamed" },
    });
    expect(res.statusCode).toBe(400); // body has no updatable field
    const mods = (
      await app.inject({ method: "GET", url: "/admin/modules", headers: { cookie: adminCookie } })
    ).json() as { key: string; label: string }[];
    expect(mods.find((x) => x.key === "admin-dsar")?.label).toBe("Admin Dsar"); // unchanged
  });

  it("404s a PATCH to an unknown module and 400s a bad body", async () => {
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/admin/modules/does-not-exist",
          headers: { cookie: adminCookie },
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/admin/modules/admin-dsar",
          headers: { cookie: adminCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/admin/modules/admin-dsar",
          headers: { cookie: adminCookie },
          payload: { label: "x".repeat(101) },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("reads and writes settings; /settings/features is user-readable, not public", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
      payload: { aiSummaryEnabled: false },
    });
    expect(patch.statusCode).toBe(204);

    const userView = await app.inject({
      method: "GET",
      url: "/settings/features",
      headers: { cookie: userCookie },
    });
    expect(userView.statusCode).toBe(200);
    expect((userView.json() as { aiSummaryEnabled: boolean }).aiSummaryEnabled).toBe(false);

    expect((await app.inject({ method: "GET", url: "/settings/features" })).statusCode).toBe(401);

    // Restore + reset the cache so other suites see defaults.
    await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
      payload: { aiSummaryEnabled: true },
    });
    invalidatePolicyCache();
  });

  it("exposes and updates retention_days via /admin/settings", async () => {
    const get1 = await app.inject({
      method: "GET",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
    });
    expect((get1.json() as { retentionDays: number }).retentionDays).toBe(30); // migration default

    const patch = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
      payload: { retentionDays: 14 },
    });
    expect(patch.statusCode).toBe(204);

    const get2 = await app.inject({
      method: "GET",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
    });
    expect((get2.json() as { retentionDays: number }).retentionDays).toBe(14);

    // /settings/features stays booleans-only — retention is admin config, not user-facing.
    const userView = await app.inject({
      method: "GET",
      url: "/settings/features",
      headers: { cookie: userCookie },
    });
    expect((userView.json() as Record<string, unknown>).retentionDays).toBeUndefined();

    // Restore the default + reset the cache for other suites.
    await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
      payload: { retentionDays: 30 },
    });
    invalidatePolicyCache();
  });

  it("rejects a non-positive retention_days", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/settings",
      headers: { cookie: adminCookie },
      payload: { retentionDays: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});
