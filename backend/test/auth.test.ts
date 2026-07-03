import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { hashPassword } from "../src/auth/password";
import { requireAdmin } from "../src/auth/guards";
import { buildServer } from "../src/server";

const PW = "test-pass-123";
let app: FastifyInstance;

// Deterministic fixture, distinct from the demo seed so tests don't depend on it.
async function seedFixture(): Promise<void> {
  await query("DELETE FROM users WHERE username IN ('t_admin', 't_user')");
  await query(
    "INSERT INTO roles (key, label) VALUES ('admin', 'Administrator') ON CONFLICT DO NOTHING",
  );
  const hash = await hashPassword(PW);
  const admin = await query<{ id: string }>(
    "INSERT INTO users (username, display_name, password_hash) VALUES ('t_admin', 'Test Admin', $1) RETURNING id",
    [hash],
  );
  await query("INSERT INTO user_roles (user_id, role_key) VALUES ($1, 'admin')", [
    admin.rows[0]?.id,
  ]);
  await query(
    "INSERT INTO users (username, display_name, password_hash) VALUES ('t_user', 'Test User', $1)",
    [hash],
  );
}

beforeAll(async () => {
  await migrate();
  await seedFixture();
  app = await buildServer();
  // Throwaway admin-guarded route to exercise requireAdmin end-to-end.
  app.get("/__test/admin-only", { preHandler: requireAdmin }, async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await query("DELETE FROM users WHERE username IN ('t_admin', 't_user')");
  await app.close();
  await closePool();
});

function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === "session");
  if (!cookie) throw new Error("expected a session cookie to be set");
  return cookie.value;
}

function login(username: string, password: string) {
  return app.inject({ method: "POST", url: "/auth/login", payload: { username, password } });
}

describe("auth flow", () => {
  it("logs in with valid credentials and sets a session cookie", async () => {
    const res = await login("t_user", PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe("t_user");
    expect(sessionCookie(res)).toBeTruthy();
  });

  it("rejects a wrong password with 401", async () => {
    expect((await login("t_user", "wrong")).statusCode).toBe(401);
  });

  it("rejects an unknown user with 401", async () => {
    expect((await login("ghost", PW)).statusCode).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("GET /auth/me returns roles and teamIds for the session user", async () => {
    const cookie = sessionCookie(await login("t_admin", PW));
    const me = await app.inject({ method: "GET", url: "/auth/me", cookies: { session: cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.roles).toContain("admin");
    expect(Array.isArray(me.json().user.teamIds)).toBe(true);
  });

  it("GET /auth/me is 401 without a session", async () => {
    expect((await app.inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401);
  });

  it("requireAdmin blocks a non-admin (403) and allows an admin (200)", async () => {
    const userCookie = sessionCookie(await login("t_user", PW));
    const adminCookie = sessionCookie(await login("t_admin", PW));
    const blocked = await app.inject({
      method: "GET",
      url: "/__test/admin-only",
      cookies: { session: userCookie },
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/__test/admin-only",
      cookies: { session: adminCookie },
    });
    expect(blocked.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
  });

  it("logout clears the session cookie", async () => {
    const cookie = sessionCookie(await login("t_user", PW));
    const out = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { session: cookie },
    });
    expect(out.statusCode).toBe(204);
    // The client replaces its cookie with the cleared one from the logout response;
    // that cleared cookie must no longer authenticate.
    const cleared = out.cookies.find((c) => c.name === "session");
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { session: cleared?.value ?? "" },
    });
    expect(me.statusCode).toBe(401);
  });
});
