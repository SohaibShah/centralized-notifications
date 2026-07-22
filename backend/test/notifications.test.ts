import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { NotificationCounts, NotificationPage } from "@notifications/shared";
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
    // The feed is now audience-scoped: put this user on team `eng` so the team-scoped n2 (below) is
    // visible to it — these tests exercise ordering/pagination over the full seeded set, not audience.
    await query(
      "INSERT INTO teams (key, label) VALUES ('eng', 'Engineering') ON CONFLICT DO NOTHING",
    );
    await query("INSERT INTO user_teams (user_id, team_key) VALUES ($1, 'eng')", [userId]);

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
    await query("DELETE FROM notifications WHERE id LIKE $1", ["test-sort-%"]);
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

  it("defaults a stored action's kind to 'link' on read (legacy rows without a kind field)", async () => {
    const id = `${ID_PREFIX}legacy-action`;
    await query(
      `INSERT INTO notifications
         (id, module, title, description, priority, snoozable, audience_scope, actions, created_at)
       VALUES ($1, 'test', 'legacy', 'body', 'normal', true, 'global', $2::jsonb, $3)`,
      [id, JSON.stringify([{ label: "Review", method: "GET", url: "https://app/x" }]), tsAt(10)],
    );
    try {
      const { body } = await list("?limit=100");
      const item = body.items.find((n) => n.id === id);
      expect(item?.actions?.[0]?.kind).toBe("link"); // default applied on read
    } finally {
      await query("DELETE FROM notifications WHERE id = $1", [id]);
    }
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
      JSON.stringify({ s: "newest", ts: "1970-01-01T00:00:00.000Z", id: "0" }),
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

  describe("sort", () => {
    const SP = "test-sort-";
    async function seedSortSet() {
      await query("DELETE FROM notifications WHERE id LIKE $1", [`${SP}%`]);
      // (id, priority, created_at) — times ascending c<h<n<l by minute for deterministic ties
      const rows: [string, string, number][] = [
        [`${SP}crit-old`, "critical", 1],
        [`${SP}crit-new`, "critical", 4],
        [`${SP}high`, "high", 2],
        [`${SP}low`, "low", 3],
      ];
      for (const [id, prio, m] of rows) {
        await query(
          `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope, created_at)
             VALUES ($1,'test','t','',$2,true,'global',$3)`,
          [id, prio, tsAt(m)],
        );
      }
    }
    function mine(body: NotificationPage): string[] {
      return body.items.filter((n) => n.id.startsWith(SP)).map((n) => n.id);
    }

    // Collect our SP rows across all keyset pages for a sort. The shared dev DB holds hundreds of
    // rows, and our future-dated rows land on the LAST page under an ascending sort — so a single
    // limit=100 page isn't enough; walk to the end (cap guards a non-terminating cursor).
    async function collectMine(sort: string): Promise<string[]> {
      const out: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 50; i++) {
        const qs = `?limit=100&sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const { body } = await list(qs);
        out.push(...mine(body));
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      return out;
    }

    it("sorts newest and oldest by time", async () => {
      await seedSortSet();
      const newest = await collectMine("newest");
      expect(newest).toEqual([`${SP}crit-new`, `${SP}low`, `${SP}high`, `${SP}crit-old`]);
      const oldest = await collectMine("oldest");
      expect(oldest).toEqual([...newest].reverse());
    });

    it("sorts by priority in both directions, newest within a level", async () => {
      await seedSortSet();
      const high = mine((await list("?limit=100&sort=priority-high")).body);
      expect(high).toEqual([`${SP}crit-new`, `${SP}crit-old`, `${SP}high`, `${SP}low`]);
      const low = mine((await list("?limit=100&sort=priority-low")).body);
      expect(low).toEqual([`${SP}low`, `${SP}high`, `${SP}crit-new`, `${SP}crit-old`]);
    });

    it("keyset-paginates priority-high with no overlap or skip", async () => {
      await seedSortSet();
      // Our four rows span the whole rank order (crit→low), and the shared DB holds other
      // rows between them, so a limit=2 walk must traverse the entire feed to reach our `low`
      // (newest within its rank). Walk to the natural end (null cursor); the cap only guards
      // against a cursor that never terminates. Collecting all four in order, with no dupes,
      // is the keyset integrity check.
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 500; i++) {
        const qs = `?limit=2&sort=priority-high${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const { body } = await list(qs);
        seen.push(...body.items.filter((n) => n.id.startsWith(SP)).map((n) => n.id));
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([`${SP}crit-new`, `${SP}crit-old`, `${SP}high`, `${SP}low`]);
      expect(new Set(seen).size).toBe(seen.length); // no dupes
    });

    it("rejects a cursor replayed under a different sort (400)", async () => {
      await seedSortSet();
      const first = (await list("?limit=1&sort=newest")).body;
      expect(first.nextCursor).toBeTruthy();
      const res = await list(
        `?limit=1&sort=oldest&cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      expect(res.statusCode).toBe(400);
    });

    it("keyset-paginates priority-low with no overlap or skip", async () => {
      await seedSortSet();
      // priority-low is the sort NOT covered by a forward/backward scan of the priority-high
      // index (rank DESC + time DESC), so it's the pagination path most worth exercising.
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 500; i++) {
        const qs = `?limit=2&sort=priority-low${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const { body } = await list(qs);
        seen.push(...body.items.filter((n) => n.id.startsWith(SP)).map((n) => n.id));
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([`${SP}low`, `${SP}high`, `${SP}crit-new`, `${SP}crit-old`]);
      expect(new Set(seen).size).toBe(seen.length); // no dupes
    });

    it("rejects a priority-sort cursor missing rank (400, not an empty page)", async () => {
      const bad = Buffer.from(
        JSON.stringify({ s: "priority-high", ts: "2099-01-01T00:00:00.000Z", id: "x" }),
      ).toString("base64url");
      const res = await list(`?limit=1&sort=priority-high&cursor=${encodeURIComponent(bad)}`);
      expect(res.statusCode).toBe(400);
    });
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

  function markUnread(id: string, cookie: string | null = sessionCookie) {
    return app.inject({
      method: "DELETE",
      url: `/notifications/${encodeURIComponent(id)}/read`,
      headers: cookie ? { cookie } : {},
    });
  }

  describe("DELETE /notifications/:id/read", () => {
    it("401s without a session cookie", async () => {
      expect((await markUnread(`${ID_PREFIX}3`, null)).statusCode).toBe(401);
    });

    it("clears the read flag (204) and the list reflects it, idempotently", async () => {
      // Read it first, confirm, then un-read.
      expect((await markRead(`${ID_PREFIX}3`)).statusCode).toBe(204);
      expect(
        (await list("?limit=100")).body.items.find((n) => n.id === `${ID_PREFIX}3`)?.read,
      ).toBe(true);

      const del = await markUnread(`${ID_PREFIX}3`);
      expect(del.statusCode).toBe(204);
      expect(
        (await list("?limit=100")).body.items.find((n) => n.id === `${ID_PREFIX}3`)?.read,
      ).toBe(false);

      // Idempotent: un-reading an already-unread notification is still 204.
      expect((await markUnread(`${ID_PREFIX}3`)).statusCode).toBe(204);
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

  describe("GET /notifications/counts", () => {
    const CP = "test-counts-";
    const CU = "t_counts";
    let cookie: string;
    let cUserId: string;

    beforeAll(async () => {
      await query("DELETE FROM notifications WHERE id LIKE $1", [`${CP}%`]);
      await query("DELETE FROM users WHERE username = $1", [CU]);
      const { rows } = await query<{ id: string }>(
        "INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'Counts', $2) RETURNING id",
        [CU, await hashPassword(PW)],
      );
      cUserId = rows[0]!.id;
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: CU, password: PW },
      });
      const sc = login.headers["set-cookie"];
      cookie = ((Array.isArray(sc) ? sc[0] : sc) ?? "").split(";")[0] ?? "";
    });

    afterAll(async () => {
      await query("DELETE FROM notifications WHERE id LIKE $1", [`${CP}%`]);
      await query("DELETE FROM users WHERE username = $1", [CU]);
    });

    function getCounts() {
      return app
        .inject({ method: "GET", url: "/notifications/counts", headers: { cookie } })
        .then((res) => ({ statusCode: res.statusCode, body: res.json() as NotificationCounts }));
    }

    it("401s without a session", async () => {
      const res = await app.inject({ method: "GET", url: "/notifications/counts" });
      expect(res.statusCode).toBe(401);
    });

    it("counts unread by priority (delta), excluding read and suppressed rows", async () => {
      const before = (await getCounts()).body;
      await query(
        `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope, suppressed)
         VALUES ($1,'test','t','','critical',true,'global',false),
                ($2,'test','t','','critical',true,'global',false),
                ($3,'test','t','','high',true,'global',false),
                ($4,'test','t','','critical',true,'global',true)`,
        [`${CP}c1`, `${CP}c2`, `${CP}h1`, `${CP}sup`],
      );
      const after = (await getCounts()).body;
      expect(after.unreadByPriority.critical - before.unreadByPriority.critical).toBe(2); // suppressed excluded
      expect(after.unreadByPriority.high - before.unreadByPriority.high).toBe(1);
      expect(after.unread - before.unread).toBe(3);

      await query("INSERT INTO notification_reads (user_id, notification_id) VALUES ($1, $2)", [
        cUserId,
        `${CP}c1`,
      ]);
      const afterRead = (await getCounts()).body;
      expect(afterRead.unreadByPriority.critical - before.unreadByPriority.critical).toBe(1);
      expect(afterRead.unread - before.unread).toBe(2);
    });
  });
});
