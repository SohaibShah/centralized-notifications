import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { hashPassword } from "../src/auth/password";
import { buildServer } from "../src/server";

const PW = "tz-pass-123";
let app: FastifyInstance;

beforeAll(async () => {
  await migrate();
  await query("DELETE FROM users WHERE username = 'tz_user'");
  const hash = await hashPassword(PW);
  await query(
    "INSERT INTO users (username, display_name, password_hash) VALUES ('tz_user', 'TZ User', $1)",
    [hash],
  );
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await query("DELETE FROM users WHERE username = 'tz_user'");
  await app.close();
  await closePool();
});

function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === "session");
  if (!cookie) throw new Error("expected a session cookie");
  return cookie.value;
}

async function loginCookie(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username: "tz_user", password: PW },
  });
  expect(res.statusCode).toBe(200);
  return sessionCookie(res);
}

test("a valid timezone is persisted", async () => {
  const session = await loginCookie();
  const res = await app.inject({
    method: "PATCH",
    url: "/me/timezone",
    cookies: { session },
    payload: { timezone: "Asia/Kolkata" },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ timezone: "Asia/Kolkata" });

  const { rows } = await query<{ timezone: string }>(
    "SELECT timezone FROM users WHERE username = 'tz_user'",
  );
  expect(rows[0]?.timezone).toBe("Asia/Kolkata");
});

test("an unknown timezone is rejected with 400", async () => {
  const session = await loginCookie();
  const res = await app.inject({
    method: "PATCH",
    url: "/me/timezone",
    cookies: { session },
    payload: { timezone: "Mars/Olympus_Mons" },
  });
  expect(res.statusCode).toBe(400);
});

test("unauthenticated requests are rejected with 401", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/me/timezone",
    payload: { timezone: "UTC" },
  });
  expect(res.statusCode).toBe(401);
});
