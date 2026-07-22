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
