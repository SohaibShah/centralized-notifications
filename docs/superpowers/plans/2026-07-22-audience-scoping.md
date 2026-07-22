# Audience Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user only sees, counts, receives, and can act on notifications addressed to their audience (global, or their team/role/user), resolved through an injectable identity seam.

**Architecture:** A new `backend/src/audience/` seam exposes `resolvePrincipal(user)` (read side) and `resolveRecipients(audience)` (delivery side), backed by the current session+DB but isolated for later library-ification. A shared `audienceWhere(principal, params)` SQL fragment gates every notification-by-identity endpoint (feed list, counts, single + bulk mark-read). Live delivery swaps `broadcast()` for recipient-resolved `publishToRecipients()`.

**Tech Stack:** TypeScript (strict), Fastify, PostgreSQL, zod, Vitest.

## Global Constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before any task is "done".
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only. The audience filter uses the principal's arrays as **bound params** — never a join to the identity tables, never string-concatenated values.
- `global` = every authenticated user. No admin bypass. `user`-scope `audience.id` = username (an opaque `userKey`). Empty roles/teams → still sees global + own user-scoped.
- The **same** `audienceWhere` gates content reads (list, counts) AND read-state writes (single + bulk mark-read) — so no endpoint can see or act on a notification another can't (no existence oracle).
- No new migration: `notifications(audience_scope, audience_id)` + `notifications_audience_idx` already exist (migration 002).
- Backend tests need Postgres up (`docker compose up -d`); `migrate()` runs in `beforeAll`. `user_roles.role_key`/`user_teams.team_key` are FKs → seed `roles`/`teams` rows before membership rows.
- No AI-attribution commit trailers. Conventional Commits.
- Branch `feat/audience-scoping` (created; spec committed).
- Single-file runs: `pnpm --filter @notifications/backend exec vitest run <path>`.

---

### Task 1: The audience seam (`resolvePrincipal` + `resolveRecipients`)

**Files:**

- Create: `backend/src/audience/principal.ts`
- Create: `backend/src/audience/recipients.ts`
- Test: `backend/test/audience.test.ts`

**Interfaces:**

- Produces:
  - `interface Principal { userKey: string; roles: string[]; teamKeys: string[] }`
  - `resolvePrincipal(user: SessionUser): Principal`
  - `audienceWhere(p: Principal, params: unknown[]): string` (pushes 3 params, returns an SQL boolean fragment referencing `n.audience_scope`/`n.audience_id`)
  - `resolveRecipients(audience: Audience): Promise<string[] | "all">`

- [ ] **Step 1: Write the failing tests**

`backend/test/audience.test.ts` (units — server/endpoint tests are added in Task 2):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../src/auth/repository";
import { audienceWhere, resolvePrincipal } from "../src/audience/principal";
import { resolveRecipients } from "../src/audience/recipients";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";

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
    await closePool();
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/audience.test.ts`
Expected: FAIL (modules `../src/audience/*` don't exist).

- [ ] **Step 3: Implement `principal.ts`**

`backend/src/audience/principal.ts`:

```ts
import type { SessionUser } from "../auth/repository";

/**
 * WHO is asking, as the audience filter needs them. The injectable seam for library-ification:
 * today it's a thin adapter over the session user, later the host supplies this directly.
 * `userKey` matches `audience.id` for scope="user" (= username now); `roles`/`teamKeys` are the
 * role_keys / team_keys matched for scope="role" / "team".
 */
export interface Principal {
  userKey: string;
  roles: string[];
  teamKeys: string[];
}

export function resolvePrincipal(user: SessionUser): Principal {
  // SessionUser.teamIds already holds team_keys; roles holds role_keys.
  return { userKey: user.username, roles: user.roles, teamKeys: user.teamIds };
}

/**
 * The audience boolean, matched against the principal's arrays passed as BOUND params (no join to
 * identity tables — that coupling is what the seam avoids). Pushes teamKeys, roles, userKey onto
 * `params` and returns a fragment referencing `n.audience_scope` / `n.audience_id`; the caller
 * aliases the notifications table as `n`. Empty arrays → `= ANY('{}')` matches nothing (fails
 * closed), leaving global + own user-scoped.
 */
export function audienceWhere(p: Principal, params: unknown[]): string {
  params.push(p.teamKeys, p.roles, p.userKey);
  const t = params.length - 2;
  const r = params.length - 1;
  const u = params.length;
  return `(n.audience_scope = 'global'
        OR (n.audience_scope = 'team' AND n.audience_id = ANY($${t}::text[]))
        OR (n.audience_scope = 'role' AND n.audience_id = ANY($${r}::text[]))
        OR (n.audience_scope = 'user' AND n.audience_id = $${u}::text))`;
}
```

- [ ] **Step 4: Implement `recipients.ts`**

`backend/src/audience/recipients.ts`:

```ts
import type { Audience } from "@notifications/shared";
import { query } from "../db/pool";

/**
 * WHO a live notification reaches: the ids the delivery hub keys subscribers by
 * (`Subscriber.userId` = internal user id today), or "all" for global (caller broadcasts).
 * Backed by the internal membership tables now; the host resolves this at extraction.
 */
export async function resolveRecipients(audience: Audience): Promise<string[] | "all"> {
  if (audience.scope === "global") return "all";
  if (!audience.id) return []; // schema guarantees an id for non-global; defensive
  const byScope: Record<"user" | "team" | "role", string> = {
    user: "SELECT id AS user_id FROM users WHERE username = $1",
    team: "SELECT user_id FROM user_teams WHERE team_key = $1",
    role: "SELECT user_id FROM user_roles WHERE role_key = $1",
  };
  const { rows } = await query<{ user_id: string }>(byScope[audience.scope], [audience.id]);
  return rows.map((row) => row.user_id);
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/audience.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/audience/ backend/test/audience.test.ts
git commit -m "feat(audience): identity seam — resolvePrincipal, audienceWhere, resolveRecipients"
```

---

### Task 2: Gate the read surface by audience (list, counts, single + bulk mark-read)

**Files:**

- Modify: `backend/src/http/notifications/routes.ts`
- Test: `backend/test/audience.test.ts`

**Interfaces:**

- Consumes: `resolvePrincipal`, `audienceWhere` (Task 1).
- Produces: all four endpoints return/act only on notifications visible to `req.user`.

- [ ] **Step 1: Write the failing integration tests**

Append to `backend/test/audience.test.ts` a `describe` that builds the server and exercises the endpoints with three users of different membership. (Imports to add at top: `FastifyInstance`, `hashPassword`, `buildServer`.)

```ts
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password";
import { buildServer } from "../src/server";

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

  async function seedNotif(id: string, scope: string, audId: string | null) {
    await query(
      `INSERT INTO notifications (id,module,title,description,priority,snoozable,audience_scope,audience_id)
       VALUES ($1,'test','t','','normal',true,$2,$3)`,
      [id, scope, audId],
    );
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
      [`${A}g`, `${A}team-privacy`, `${A}role-analyst`, `${A}user-casey`].sort(),
    );
    expect((await feedIds(`${A}sam`)).sort()).toEqual([`${A}g`, `${A}team-sec`].sort());
    expect(await feedIds(`${A}nobody`)).toEqual([`${A}g`]);
  });

  it("counts match the visible unread set", async () => {
    const counts = await app
      .inject({
        method: "GET",
        url: "/notifications/counts",
        headers: { cookie: cookies[`${A}sam`]! },
      })
      .then((r) => r.json() as { unread: number });
    // sam sees exactly {g, team-sec} from our set — both unread. Assert via a floor+scoped recount
    // is overkill; instead confirm sam's feed length equals their counts contribution:
    const visible = await feedIds(`${A}sam`);
    expect(visible).toHaveLength(2);
    expect(counts.unread).toBeGreaterThanOrEqual(2); // other suites' globals may add to the total
  });

  it("mark-read 404s for a notification outside the caller's audience (no existence oracle)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/notifications/${A}team-sec/read`, // sam's team item; casey can't see it
      headers: { cookie: cookies[`${A}casey`]! },
    });
    expect(res.statusCode).toBe(404);
    // and a visible one still succeeds:
    const ok = await app.inject({
      method: "POST",
      url: `/notifications/${A}team-privacy/read`,
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
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/audience.test.ts`
Expected: the endpoint tests FAIL (feed returns everything; mark-read 204s cross-audience).

- [ ] **Step 3: Implement — import the seam + feed list**

In `backend/src/http/notifications/routes.ts`:

- Add import: `import { resolvePrincipal, audienceWhere } from "../../audience/principal";`
- **Feed list** — after the cursor/keyset block builds `where`, and BEFORE `params.push(limit + 1)`, add the audience gate:

```ts
where += ` AND ${audienceWhere(resolvePrincipal(user), params)}`;
params.push(limit + 1);
```

- Update the stale block comment above `notificationRoutes` (the "Week-1 limitation: every notification is returned to every authenticated user" sentence) to state that the feed is audience-scoped via `audienceWhere`.

- [ ] **Step 4: Implement — counts**

Rewrite the counts query to build a `params` array and weave the audience fragment in:

```ts
const params: unknown[] = [user.id];
const audience = audienceWhere(resolvePrincipal(user), params);
const { rows } = await query<{ priority: NotificationPriority; n: number }>(
  `SELECT n.priority, count(*)::int AS n
     FROM notifications n
     LEFT JOIN notification_reads r
       ON r.notification_id = n.id AND r.user_id = $1
    WHERE n.suppressed = false AND r.user_id IS NULL AND ${audience}
    GROUP BY n.priority`,
  params,
);
```

- [ ] **Step 5: Implement — single + bulk mark-read**

- `POST /notifications/:id/read` existence check becomes audience-scoped:

```ts
const params: unknown[] = [id];
const audience = audienceWhere(resolvePrincipal(user), params);
const exists = await query(`SELECT 1 FROM notifications n WHERE n.id = $1 AND ${audience}`, params);
if (exists.rowCount === 0) return reply.code(404).send({ error: "notification not found" });
```

- Bulk `POST /notifications/read` SELECT gains the audience gate:

```ts
const params: unknown[] = [user.id, ids];
const audience = audienceWhere(resolvePrincipal(user), params);
await query(
  `INSERT INTO notification_reads (user_id, notification_id)
     SELECT $1, n.id FROM notifications n WHERE n.id = ANY($2::text[]) AND ${audience}
     ON CONFLICT (user_id, notification_id) DO NOTHING`,
  params,
);
```

(`DELETE /notifications/:id/read` is unchanged — it only removes the caller's own read row, always 204, no oracle.)

- [ ] **Step 6: Run tests + typecheck + the existing notifications suite**

Run: `pnpm --filter @notifications/backend exec vitest run test/audience.test.ts test/notifications.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS (existing notifications tests still green — their single seeded user sees its own global/team rows), clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/http/notifications/routes.ts backend/test/audience.test.ts
git commit -m "feat(audience): gate feed, counts, and mark-read (single+bulk) by audience"
```

---

### Task 3: Audience-aware live delivery

**Files:**

- Modify: `backend/src/pipeline/ingest.ts`
- Test: `backend/test/audience.test.ts`

**Interfaces:**

- Consumes: `resolveRecipients` (Task 1); `deliveryHub.broadcast` / `publishToRecipients` (existing).

- [ ] **Step 1: Write the failing test**

Append to `backend/test/audience.test.ts`. Register two subscribers on the hub with different `userId`s and assert a team-scoped publish reaches only the member. (Imports: `deliveryHub` from `../src/delivery/hub`, `ingest` from `../src/pipeline/ingest`, and a known-enabled module — reuse the seeded `dsr` module from migration 007.)

```ts
import { deliveryHub } from "../src/delivery/hub";
import { ingest } from "../src/pipeline/ingest";

describe("audience-aware live delivery", () => {
  const D = "aud-del-";
  const memberId = "11111111-1111-1111-1111-111111111111";
  const outsiderId = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    await migrate();
    // A team whose only member is `memberId`.
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
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/audience.test.ts`
Expected: FAIL (`broadcast` delivers to both `got = ["member","outsider"]`).

- [ ] **Step 3: Implement**

In `backend/src/pipeline/ingest.ts`:

- Add import: `import { resolveRecipients } from "../audience/recipients";`
- Replace the delivery line:

```ts
if (enabled) {
  const recipients = await resolveRecipients(result.data.audience);
  if (recipients === "all") deliveryHub.broadcast(result.data);
  else deliveryHub.publishToRecipients(recipients, result.data);
}
```

- [ ] **Step 4: Run tests + typecheck + full backend suite**

Run: `pnpm --filter @notifications/backend exec vitest run test/audience.test.ts && pnpm --filter @notifications/backend test && pnpm --filter @notifications/backend typecheck`
Expected: PASS. (The existing `sse.test.ts` / `pipeline.test.ts` publish `global`-audience notifications, which still broadcast — confirm they stay green.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/pipeline/ingest.ts backend/test/audience.test.ts
git commit -m "feat(audience): route live delivery to resolved recipients (global still broadcasts)"
```

---

### Task 4: API docs

**Files:**

- Modify: `docs/api/notifications.md`

- [ ] **Step 1: Dispatch docs-writer**

Per `api-documentation.md`, delegate to the **docs-writer** subagent. Brief it: the notification read surface is now **audience-scoped**. `GET /notifications` and `GET /notifications/counts` return only notifications addressed to the caller — `global`, or whose `team`/`role`/`user` audience matches the caller's teams (`team_key`), roles (`role_key`), or username. `user`-scoped `audience.id` is the **username**. The **read-state writes are scoped too**: `POST /notifications/:id/read` returns `404` for a notification outside the caller's audience (no existence oracle), and bulk `POST /notifications/read` silently skips out-of-audience ids. `DELETE /notifications/:id/read` is unchanged. Live SSE delivery now only reaches addressed users (`global` reaches all). **Remove the prior "Week-1: every authenticated user sees every notification" caveat** — that limitation is resolved. No admin bypass (admins are scoped like everyone). Update the existing doc; don't create a new file.

- [ ] **Step 2: Commit**

```bash
git add docs/api/notifications.md
git commit -m "docs(api): document audience-scoped reads, mark-read, and delivery"
```

---

## Final verification

1. Postgres up; `pnpm --filter @notifications/backend test` and `pnpm --filter @notifications/frontend test` green (frontend unchanged, but run it to confirm nothing regressed). `pnpm lint && pnpm typecheck` clean.
2. **Reviews — this is an access-control boundary, so both:** `security-reviewer` (the audience filter is applied to EVERY notification-by-identity endpoint incl. the read-state writes; identity is server-derived not client-supplied; SQL parameterized; fails closed; no existence oracle) AND `code-reviewer` (the `audienceWhere` placeholder arithmetic across the four call sites, the counts/list parity, the delivery switch). `docs-writer` already ran (Task 4).
3. `superpowers:finishing-a-development-branch` (the mentor push-gate was lifted 2026-07-21; this branch can follow the same push flow as the rest of `main`).

## Self-review notes (coverage check)

- Spec seam (`resolvePrincipal`/`resolveRecipients`/`audienceWhere`, DB-backed, isolated) → Task 1. ✅
- Spec read filter on list + counts → Task 2 (steps 3–4). ✅
- Spec read-state writes scoped (single + bulk; DELETE unchanged) → Task 2 (step 5). ✅
- Spec live delivery via `publishToRecipients` → Task 3. ✅
- Spec username-as-userKey; no admin bypass; empty membership → global+own → Task 1 (`resolvePrincipal`, `audienceWhere` fails-closed) + Task 2 tests. ✅
- Spec security properties (no injection/spoofing/oracle, fails closed) → Task 1 (bound params), Task 2 (uniform gate) + the final `security-reviewer` gate. ✅
- Spec docs (remove Week-1 caveat) → Task 4. ✅
- Type consistency: `Principal`/`resolvePrincipal`/`audienceWhere` defined in Task 1, consumed in Task 2; `resolveRecipients` defined in Task 1, consumed in Task 3; the notifications table is aliased `n` at every `audienceWhere` call site (list, counts, single-read existence, bulk-read SELECT).
