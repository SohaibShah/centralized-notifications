import { afterAll, beforeAll, expect, test } from "vitest";
import type { Audience, Notification } from "@notifications/shared";
import { audienceWhere, matchAudience } from "../src/audience/match";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import type { Principal } from "../src/types";
import { testPool } from "./harness";

// Binds the two halves of the audience invariant: the SQL predicate (read filter) and the in-memory
// predicate (delivery hub) MUST agree for every principal × audience. Edit one and forget the twin,
// and this fails. See the code-review W2 finding.

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// One persisted notification per audience shape, with a distinct id.
const audiences: { id: string; audience: Audience }[] = [
  { id: `ap-global-${stamp}`, audience: { scope: "global" } },
  { id: `ap-team-eng-${stamp}`, audience: { scope: "team", id: "eng" } },
  { id: `ap-team-ops-${stamp}`, audience: { scope: "team", id: "ops" } },
  { id: `ap-role-admin-${stamp}`, audience: { scope: "role", id: "admin" } },
  { id: `ap-role-viewer-${stamp}`, audience: { scope: "role", id: "viewer" } },
  { id: `ap-user-alice-${stamp}`, audience: { scope: "user", id: "alice" } },
  { id: `ap-user-bob-${stamp}`, audience: { scope: "user", id: "bob" } },
];

const principals: Principal[] = [
  { userKey: "alice", roles: ["admin"], teamKeys: ["eng"] },
  { userKey: "carol", roles: [], teamKeys: [] }, // outsider: only global + own user-scope
];

const notif = (id: string, audience: Audience): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  priority: "high",
  snoozable: false,
  audience,
});

beforeAll(async () => {
  for (const { id, audience } of audiences) await persist(query, notif(id, audience), false);
});

test("SQL audienceWhere and in-memory matchAudience agree for every principal × audience", async () => {
  for (const principal of principals) {
    for (const { id, audience } of audiences) {
      const params: unknown[] = [id];
      const frag = audienceWhere(principal, params);
      const { rowCount } = await query(
        `SELECT 1 FROM notifications n WHERE n.id = $1 AND ${frag}`,
        params,
      );
      const sqlSees = rowCount === 1;
      expect(sqlSees, `${principal.userKey} × ${JSON.stringify(audience)}`).toBe(
        matchAudience(principal, audience),
      );
    }
  }
});
