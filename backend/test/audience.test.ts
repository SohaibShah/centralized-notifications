import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SessionUser } from "../src/auth/repository";
import { audienceWhere, resolvePrincipal } from "../src/audience/principal";
import { resolveRecipients } from "../src/audience/recipients";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { deliveryHub } from "../src/delivery/hub";
import { ingest } from "../src/pipeline/ingest";
import { buildServer } from "../src/server";

const P = "aud-seam-";

describe("audience seam", () => {
  beforeAll(async () => {
    await migrate();
    await query("INSERT INTO roles (key,label) VALUES ($1,$1) ON CONFLICT DO NOTHING", [
      `${P}role`,
    ]);
    await query("INSERT INTO teams (key,label) VALUES ($1,$1) ON CONFLICT DO NOTHING", [
      `${P}team`,
    ]);
    await query("DELETE FROM users WHERE username LIKE $1", [`${P}%`]);
    await query("INSERT INTO users (username,display_name,password_hash) VALUES ($1,'x','x')", [
      `${P}u`,
    ]);
    const { rows } = await query<{ id: string }>("SELECT id FROM users WHERE username=$1", [
      `${P}u`,
    ]);
    const uid = rows[0]!.id;
    await query("INSERT INTO user_roles (user_id,role_key) VALUES ($1,$2)", [uid, `${P}role`]);
    await query("INSERT INTO user_teams (user_id,team_key) VALUES ($1,$2)", [uid, `${P}team`]);
  });
  afterAll(async () => {
    await query("DELETE FROM users WHERE username LIKE $1", [`${P}%`]);
    await query("DELETE FROM roles WHERE key LIKE $1", [`${P}%`]);
    await query("DELETE FROM teams WHERE key LIKE $1", [`${P}%`]);
  });

  it("resolvePrincipal maps username→userKey, and passes roles/teamKeys through", () => {
    const user = {
      id: "1",
      username: "casey",
      displayName: "Casey",
      roles: ["r1"],
      teamIds: ["t1"],
    } satisfies SessionUser;
    expect(resolvePrincipal(user)).toEqual({ userKey: "casey", roles: ["r1"], teamKeys: ["t1"] });
  });

  it("audienceWhere pushes exactly three params and references their positions", () => {
    const params: unknown[] = ["existing"];
    const sql = audienceWhere({ userKey: "casey", roles: ["r1"], teamKeys: ["t1"] }, params);
    expect(params).toEqual(["existing", ["t1"], ["r1"], "casey"]);
    expect(sql).toContain("audience_scope = 'global'");
    expect(sql).toContain("$2::text[]"); // teams
    expect(sql).toContain("$3::text[]"); // roles
    expect(sql).toContain("$4::text"); // userKey
  });

  it("resolveRecipients returns 'all' for global, member ids for team/role/user, [] for unknown", async () => {
    expect(await resolveRecipients({ scope: "global" })).toBe("all");
    const { rows } = await query<{ id: string }>("SELECT id FROM users WHERE username=$1", [
      `${P}u`,
    ]);
    const uid = rows[0]!.id;
    expect(await resolveRecipients({ scope: "team", id: `${P}team` })).toEqual([uid]);
    expect(await resolveRecipients({ scope: "role", id: `${P}role` })).toEqual([uid]);
    expect(await resolveRecipients({ scope: "user", id: `${P}u` })).toEqual([uid]);
    expect(await resolveRecipients({ scope: "team", id: "no-such-team" })).toEqual([]);
  });
});

describe("audience-scoped endpoints", () => {
  const A = "aud-ep-";
  let app: FastifyInstance;
  const cookies: Record<string, string> = {};
  const uid: Record<string, string> = {};

  async function makeUser(name: string, roles: string[], teams: string[]) {
    for (const r of roles)
      await query("INSERT INTO roles (key,label) VALUES ($1,$1) ON CONFLICT DO NOTHING", [r]);
    for (const t of teams)
      await query("INSERT INTO teams (key,label) VALUES ($1,$1) ON CONFLICT DO NOTHING", [t]);
    const { rows } = await query<{ id: string }>(
      "INSERT INTO users (username,display_name,password_hash) VALUES ($1,$1,$2) RETURNING id",
      [name, await hashPassword("pw")],
    );
    uid[name] = rows[0]!.id;
    for (const r of roles)
      await query("INSERT INTO user_roles (user_id,role_key) VALUES ($1,$2)", [uid[name], r]);
    for (const t of teams)
      await query("INSERT INTO user_teams (user_id,team_key) VALUES ($1,$2)", [uid[name], t]);
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: name, password: "pw" },
    });
    const sc = login.headers["set-cookie"];
    cookies[name] = ((Array.isArray(sc) ? sc[0] : sc) ?? "").split(";")[0] ?? "";
  }

  async function seedNotif(id: string, scope: string, audId: string | null, priority = "normal") {
    await query(
      `INSERT INTO notifications (id,module,title,description,priority,snoozable,audience_scope,audience_id)
       VALUES ($1,'test','t','',$4,true,$2,$3)`,
      [id, scope, audId, priority],
    );
  }

  function counts(
    name: string,
  ): Promise<{ unread: number; unreadByPriority: Record<string, number> }> {
    return app
      .inject({ method: "GET", url: "/notifications/counts", headers: { cookie: cookies[name]! } })
      .then((r) => r.json() as { unread: number; unreadByPriority: Record<string, number> });
  }

  function feedIds(name: string): Promise<string[]> {
    return app
      .inject({
        method: "GET",
        url: "/notifications?limit=100",
        headers: { cookie: cookies[name]! },
      })
      .then((r) =>
        (r.json() as { items: { id: string }[] }).items
          .map((n) => n.id)
          .filter((i) => i.startsWith(A)),
      );
  }

  beforeAll(async () => {
    app = await buildServer();
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${A}%`]);
    await makeUser(`${A}casey`, [`${A}analyst`], [`${A}privacy`]);
    await makeUser(`${A}sam`, [`${A}security`], [`${A}sec`]);
    await makeUser(`${A}nobody`, [], []); // no roles/teams
    await seedNotif(`${A}g`, "global", null);
    await seedNotif(`${A}team-privacy`, "team", `${A}privacy`);
    await seedNotif(`${A}team-sec`, "team", `${A}sec`);
    await seedNotif(`${A}role-analyst`, "role", `${A}analyst`);
    await seedNotif(`${A}user-casey`, "user", `${A}casey`); // audience.id = username
    // A CRITICAL item scoped to casey's team only — used to prove counts EXCLUDE out-of-audience.
    await seedNotif(`${A}crit-privacy`, "team", `${A}privacy`, "critical");
  });
  afterAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${A}%`]);
    await query("DELETE FROM users WHERE username LIKE $1", [`${A}%`]);
    await query("DELETE FROM roles WHERE key LIKE $1", [`${A}%`]);
    await query("DELETE FROM teams WHERE key LIKE $1", [`${A}%`]);
    await app.close();
  });

  it("feed returns exactly global + the user's team/role/user items", async () => {
    expect((await feedIds(`${A}casey`)).sort()).toEqual(
      [
        `${A}g`,
        `${A}team-privacy`,
        `${A}role-analyst`,
        `${A}user-casey`,
        `${A}crit-privacy`,
      ].sort(),
    );
    expect((await feedIds(`${A}sam`)).sort()).toEqual([`${A}g`, `${A}team-sec`].sort());
    expect(await feedIds(`${A}nobody`)).toEqual([`${A}g`]);
  });

  it("counts EXCLUDE out-of-audience items (a critical in casey's team is counted for casey, not sam)", async () => {
    // The critical is scoped to casey's team (aud-ep-privacy); sam is not in it. Critical globals
    // count equally for both, so the casey−sam delta isolates our audience-specific critical. If the
    // audience gate were missing from counts, both would see it and the delta would be 0.
    const casey = await counts(`${A}casey`);
    const sam = await counts(`${A}sam`);
    expect(casey.unreadByPriority.critical! - sam.unreadByPriority.critical!).toBe(1);
  });

  it("mark-read 404s for a notification outside the caller's audience (no existence oracle)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${A}team-sec/read`, // sam's team item; casey can't see it
      headers: { cookie: cookies[`${A}casey`]! },
    });
    expect(res.statusCode).toBe(404);
    const ok = await app.inject({
      method: "POST",
      url: `/notifications/${A}team-privacy/read`, // casey CAN see it
      headers: { cookie: cookies[`${A}casey`]! },
    });
    expect(ok.statusCode).toBe(204);
  });

  it("bulk mark-read skips out-of-audience ids (no read row created)", async () => {
    await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: { cookie: cookies[`${A}nobody`]! },
      payload: { ids: [`${A}team-sec`, `${A}role-analyst`] }, // none visible to nobody
    });
    const reads = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM notification_reads WHERE user_id = $1 AND notification_id LIKE $2",
      [uid[`${A}nobody`], `${A}%`],
    );
    expect(reads.rows[0]!.n).toBe("0");
  });

  it("bulk mark-read DOES create a read row for an in-audience id", async () => {
    await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: { cookie: cookies[`${A}casey`]! },
      payload: { ids: [`${A}role-analyst`] }, // visible to casey (analyst role)
    });
    const reads = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM notification_reads WHERE user_id = $1 AND notification_id = $2",
      [uid[`${A}casey`], `${A}role-analyst`],
    );
    expect(reads.rows[0]!.n).toBe("1");
  });
});

describe("audience-aware live delivery", () => {
  const D = "aud-del-";
  const memberId = "11111111-1111-1111-1111-111111111111";
  const outsiderId = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    await migrate();
    await query("INSERT INTO teams (key,label) VALUES ($1,$1) ON CONFLICT DO NOTHING", [
      `${D}team`,
    ]);
    await query(
      "INSERT INTO users (id,username,display_name,password_hash) VALUES ($1,$2,'x','x') ON CONFLICT DO NOTHING",
      [memberId, `${D}member`],
    );
    await query("INSERT INTO user_teams (user_id,team_key) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
      memberId,
      `${D}team`,
    ]);
  });
  afterAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${D}%`]);
    await query("DELETE FROM user_teams WHERE team_key LIKE $1", [`${D}%`]);
    await query("DELETE FROM users WHERE username LIKE $1", [`${D}%`]);
    await query("DELETE FROM teams WHERE key LIKE $1", [`${D}%`]);
  });

  it("delivers a team-scoped notification only to a subscriber in that team", async () => {
    const got: string[] = [];
    const offMember = deliveryHub.subscribe({
      userId: memberId,
      deliver: () => got.push("member"),
    });
    const offOutsider = deliveryHub.subscribe({
      userId: outsiderId,
      deliver: () => got.push("outsider"),
    });
    try {
      await ingest({
        id: `${D}t1`,
        module: "dsr", // seeded + enabled (migration 007)
        title: "team only",
        description: "",
        priority: "normal",
        snoozable: true,
        audience: { scope: "team", id: `${D}team` },
      });
    } finally {
      offMember();
      offOutsider();
    }
    expect(got).toEqual(["member"]); // outsider did NOT receive it
  });

  it("delivers a global notification to every connected subscriber (broadcast branch)", async () => {
    const got: string[] = [];
    const offMember = deliveryHub.subscribe({
      userId: memberId,
      deliver: () => got.push("member"),
    });
    const offOutsider = deliveryHub.subscribe({
      userId: outsiderId,
      deliver: () => got.push("outsider"),
    });
    try {
      await ingest({
        id: `${D}g1`,
        module: "dsr",
        title: "everyone",
        description: "",
        priority: "normal",
        snoozable: true,
        audience: { scope: "global" },
      });
    } finally {
      offMember();
      offOutsider();
    }
    expect(got.sort()).toEqual(["member", "outsider"]); // global reaches all connected
  });
});

// One pool-close for the whole file (multiple describes share the singleton pool).
afterAll(async () => {
  await closePool();
});
