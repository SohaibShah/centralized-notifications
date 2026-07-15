import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { NotificationPage } from "@notifications/shared";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { buildServer } from "../src/server";

const ID_PREFIX = "test-notif-";
const USERNAME = "t_notif";
const PW = "test-notif-pass";

// Five notifications with explicit, strictly increasing created_at so the newest-first
// keyset order (created_at desc, id desc) is deterministic: n5, n4, n3, n2, n1. Dated in
// the far future so they are the newest rows in the *shared* dev DB regardless of what
// other suites (or a dev seed) inserted — the test isolates on ids, not on an empty table.
const BASE_TS = "2099-01-01T00:00:00.000Z";
function tsAt(minute: number): string {
  return new Date(new Date(BASE_TS).getTime() + minute * 60_000).toISOString();
}
const IDS = [1, 2, 3, 4, 5].map((n) => `${ID_PREFIX}${n}`);
const NEWEST_FIRST = [...IDS].reverse(); // [n5, n4, n3, n2, n1]

describe("GET /notifications", () => {
  let app: FastifyInstance;
  let userId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${ID_PREFIX}%`]);
    await query("DELETE FROM users WHERE username = $1", [USERNAME]);

    const { rows } = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'Notif User', $2) RETURNING id",
      [USERNAME, await hashPassword(PW)],
    );
    userId = rows[0]!.id;

    // Seed five notifications; n2 is team-scoped to exercise audience reconstruction.
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i]!;
      const teamScoped = id === `${ID_PREFIX}2`;
      await query(
        `INSERT INTO notifications
           (id, module, title, description, priority, snoozable, category,
            audience_scope, audience_id, created_at)
         VALUES ($1, 'test', $2, 'body', 'normal', true, 'ops',
                 $3, $4, $5)`,
        [
          id,
          `Notification ${i + 1}`,
          teamScoped ? "team" : "global",
          teamScoped ? "eng" : null,
          tsAt(i + 1),
        ],
      );
    }

    app = await buildServer();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: USERNAME, password: PW },
    });
    expect(login.statusCode).toBe(200);
    const rawSetCookie = login.headers["set-cookie"];
    const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0] : rawSetCookie;
    sessionCookie = (setCookie ?? "").split(";")[0] ?? "";
    expect(sessionCookie).toMatch(/^session=.+/);
  });

  afterAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${ID_PREFIX}%`]);
    await query("DELETE FROM users WHERE username = $1", [USERNAME]);
    await app.close();
    await closePool();
  });

  function list(qs = ""): Promise<{ statusCode: number; body: NotificationPage }> {
    return app
      .inject({ method: "GET", url: `/notifications${qs}`, headers: { cookie: sessionCookie } })
      .then((res) => ({ statusCode: res.statusCode, body: res.json() as NotificationPage }));
  }

  it("401s without a session cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/notifications" });
    expect(res.statusCode).toBe(401);
  });

  it("returns notifications newest-first with read=false by default", async () => {
    const { statusCode, body } = await list("?limit=100");
    expect(statusCode).toBe(200);
    const ours = body.items.filter((n) => n.id.startsWith(ID_PREFIX));
    expect(ours.map((n) => n.id)).toEqual(NEWEST_FIRST);
    expect(ours.every((n) => n.read === false)).toBe(true);
  });

  it("reconstructs the audience shape (global vs team) and createdAt", async () => {
    const { body } = await list("?limit=100");
    const byId = new Map(body.items.map((n) => [n.id, n]));
    expect(byId.get(`${ID_PREFIX}1`)?.audience).toEqual({ scope: "global" });
    expect(byId.get(`${ID_PREFIX}2`)?.audience).toEqual({ scope: "team", id: "eng" });
    // createdAt is a full-precision (microsecond) ISO string; compare as the same instant.
    const createdAt = byId.get(`${ID_PREFIX}1`)?.createdAt ?? "";
    expect(new Date(createdAt).toISOString()).toBe(tsAt(1));
  });

  it("paginates via the opaque cursor in order with no overlap", async () => {
    // Our rows are the newest in the table (future-dated), so a limit=2 walk from the
    // top reaches all five within the first few pages regardless of other suites' data.
    // Stop at the true end (null cursor) or once we've collected all five.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 8; page++) {
      const qs: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
      const { body }: { body: NotificationPage } = await list(qs);
      seen.push(...body.items.filter((n) => n.id.startsWith(ID_PREFIX)).map((n) => n.id));
      cursor = body.nextCursor;
      if (!cursor || seen.length >= IDS.length) break;
    }
    // Complete, correctly ordered, and no duplicates (keyset guarantee).
    expect(seen).toEqual(NEWEST_FIRST);
  });

  it("does not skip rows sharing a millisecond across a page boundary", async () => {
    // Two rows in the SAME millisecond but different microseconds. node-pg would parse
    // created_at into a millisecond-precision Date; if the cursor were built from that
    // Date, the older (…001Z) row would compare as newer than the truncated cursor and
    // be silently dropped. The endpoint formats created_at in SQL to microseconds, so a
    // limit=1 walk must return BOTH, newest µs first. (Future-dated for isolation.)
    const msIds = [`${ID_PREFIX}ms-a`, `${ID_PREFIX}ms-b`];
    await query("DELETE FROM notifications WHERE id = ANY($1)", [msIds]);
    await query(
      `INSERT INTO notifications
         (id, module, title, description, priority, snoozable, audience_scope, created_at)
       VALUES
         ($1, 'test', 'ms A', '', 'normal', true, 'global', '2099-06-01T00:00:00.000001Z'),
         ($2, 'test', 'ms B', '', 'normal', true, 'global', '2099-06-01T00:00:00.000002Z')`,
      msIds,
    );

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const qs: string = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : "?limit=1";
      const { body }: { body: NotificationPage } = await list(qs);
      collected.push(...body.items.filter((n) => msIds.includes(n.id)).map((n) => n.id));
      cursor = body.nextCursor;
      if (!cursor || collected.length >= msIds.length) break;
    }

    await query("DELETE FROM notifications WHERE id = ANY($1)", [msIds]);
    // Both present, newest microsecond first — nothing dropped at the boundary.
    expect(collected).toEqual([`${ID_PREFIX}ms-b`, `${ID_PREFIX}ms-a`]);
  });

  it("returns an empty page and null cursor past the end", async () => {
    // A cursor positioned before the oldest possible row: nothing is older, so the
    // handler must return no items and signal the end with a null cursor (this is how
    // the client knows to stop paging). Isolation-safe — independent of table size.
    const pastCursor = Buffer.from(
      JSON.stringify({ ts: "1970-01-01T00:00:00.000Z", id: "0" }),
    ).toString("base64url");
    const { body } = await list(`?cursor=${encodeURIComponent(pastCursor)}`);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("reflects this user's read state via the LEFT JOIN", async () => {
    await query(
      "INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, `${ID_PREFIX}3`],
    );
    const { body } = await list("?limit=100");
    const byId = new Map(body.items.map((n) => [n.id, n]));
    expect(byId.get(`${ID_PREFIX}3`)?.read).toBe(true);
    expect(byId.get(`${ID_PREFIX}4`)?.read).toBe(false);
  });

  it("rejects a malformed cursor with 400", async () => {
    const { statusCode } = await list("?cursor=not-a-real-cursor");
    expect(statusCode).toBe(400);
  });

  it("rejects an out-of-range limit with 400", async () => {
    expect((await list("?limit=0")).statusCode).toBe(400);
    expect((await list("?limit=99999")).statusCode).toBe(400);
    expect((await list("?limit=abc")).statusCode).toBe(400);
  });

  function markRead(id: string, cookie: string | null = sessionCookie) {
    return app.inject({
      method: "POST",
      url: `/notifications/${encodeURIComponent(id)}/read`,
      headers: cookie ? { cookie } : {},
    });
  }

  describe("POST /notifications/:id/read", () => {
    it("401s without a session cookie", async () => {
      const res = await markRead(`${ID_PREFIX}4`, null);
      expect(res.statusCode).toBe(401);
    });

    it("404s for a notification that does not exist", async () => {
      const res = await markRead(`${ID_PREFIX}does-not-exist`);
      expect(res.statusCode).toBe(404);
    });

    it("400s for an id longer than the 200-char bound", async () => {
      const res = await markRead("x".repeat(201));
      expect(res.statusCode).toBe(400);
    });

    it("marks a notification read (204) and the list reflects it", async () => {
      const before = await list("?limit=100");
      expect(before.body.items.find((n) => n.id === `${ID_PREFIX}4`)?.read).toBe(false);

      const res = await markRead(`${ID_PREFIX}4`);
      expect(res.statusCode).toBe(204);

      const after = await list("?limit=100");
      expect(after.body.items.find((n) => n.id === `${ID_PREFIX}4`)?.read).toBe(true);
    });

    it("is idempotent — marking read twice still succeeds", async () => {
      expect((await markRead(`${ID_PREFIX}5`)).statusCode).toBe(204);
      expect((await markRead(`${ID_PREFIX}5`)).statusCode).toBe(204);
      const after = await list("?limit=100");
      expect(after.body.items.find((n) => n.id === `${ID_PREFIX}5`)?.read).toBe(true);
    });
  });

  describe("POST /notifications/read (bulk)", () => {
    it("401 without a session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/notifications/read",
        payload: { ids: [IDS[0]] },
      });
      expect(res.statusCode).toBe(401);
    });

    it("400 on an invalid body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/notifications/read",
        headers: { cookie: sessionCookie },
        payload: { ids: [] }, // empty not allowed
      });
      expect(res.statusCode).toBe(400);
    });

    it("marks the given ids read for the caller, ignores unknown ids, and is idempotent", async () => {
      const bogus = "does-not-exist-xyz";
      const first = await app.inject({
        method: "POST",
        url: "/notifications/read",
        headers: { cookie: sessionCookie },
        payload: { ids: [IDS[0], IDS[1], bogus] },
      });
      expect(first.statusCode).toBe(204);

      // A repeat is a no-op (idempotent).
      const again = await app.inject({
        method: "POST",
        url: "/notifications/read",
        headers: { cookie: sessionCookie },
        payload: { ids: [IDS[0], IDS[1], bogus] },
      });
      expect(again.statusCode).toBe(204);

      // The two real ids now read back as read; the bogus id created no row.
      const list = await app.inject({
        method: "GET",
        url: "/notifications?limit=100",
        headers: { cookie: sessionCookie },
      });
      const body = list.json() as NotificationPage;
      const byId = new Map(body.items.map((n) => [n.id, n.read]));
      expect(byId.get(IDS[0]!)).toBe(true);
      expect(byId.get(IDS[1]!)).toBe(true);
      const reads = await query<{ n: string }>(
        "SELECT count(*)::text AS n FROM notification_reads WHERE user_id = $1 AND notification_id = $2",
        [userId, bogus],
      );
      expect(reads.rows[0]!.n).toBe("0");
    });

    it("400 when ids array exceeds max(500)", async () => {
      const tooManyIds = Array.from({ length: 501 }, (_, i) => `n${i}`);
      const res = await app.inject({
        method: "POST",
        url: "/notifications/read",
        headers: { cookie: sessionCookie },
        payload: { ids: tooManyIds },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400 when an id exceeds max(200) characters", async () => {
      const longId = "x".repeat(201);
      const res = await app.inject({
        method: "POST",
        url: "/notifications/read",
        headers: { cookie: sessionCookie },
        payload: { ids: [longId] },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
