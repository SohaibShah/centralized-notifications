import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { retrieveForAnswer } from "../src/ai/retrieve";
import type { Principal } from "../src/types";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

// The stats assertions below count the whole audience-scoped set; global-scoped notifications seeded
// by sibling files are visible to every principal and can't be id-isolated, so clear them once for a
// deterministic count (same rationale as summarize.test.ts).
beforeAll(async () => {
  await query(`DELETE FROM notifications WHERE audience_scope = 'global'`);
});

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function seed(n: Partial<Notification> & { id: string; userScope: string }): Promise<void> {
  const { userScope, ...rest } = n;
  const full: Notification = {
    module: "dsr",
    title: n.id,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: userScope },
    ...rest,
  } as Notification;
  await persist(query, full, false);
}

async function markRead(userKey: string, id: string): Promise<void> {
  await query(
    `INSERT INTO notification_reads (user_key, notification_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
    [userKey, id],
  );
}

test("FTS hit + recency union, audience-scoped, with read flags", async () => {
  const userKey = `ret-${stamp}`;
  const keyword = `zbqx${stamp.replace(/[^a-z0-9]/gi, "")}`;
  const principal: Principal = { userKey, roles: [], teamKeys: [] };

  // (a) FTS-matchable, marked read
  await seed({
    id: `ret-a-${stamp}`,
    userScope: userKey,
    title: `Alert about ${keyword}`,
    description: "details",
    priority: "normal",
  });
  await markRead(userKey, `ret-a-${stamp}`);
  // (b) high-priority critical, NO keyword, unread
  await seed({
    id: `ret-b-${stamp}`,
    userScope: userKey,
    title: "Unrelated urgent thing",
    priority: "critical",
  });
  // (c) another user's notification containing the keyword — must be excluded
  await seed({
    id: `ret-c-${stamp}`,
    userScope: `other-${stamp}`,
    title: `Secret ${keyword} for someone else`,
  });

  const { items } = await retrieveForAnswer(query, principal, keyword);
  const a = items.find((i) => i.title.includes(keyword));
  const b = items.find((i) => i.title === "Unrelated urgent thing");

  expect(a).toBeDefined();
  expect(a!.read).toBe(true);
  expect(b).toBeDefined();
  expect(b!.read).toBe(false);
  // audience isolation: the other user's keyword item never surfaces
  expect(items.some((i) => i.title.includes("someone else"))).toBe(false);
  // shape
  expect(typeof a!.ageMinutes).toBe("number");
  expect(a!.priority).toBe("normal");
  expect(a!.module).toBe("dsr");
  expect(typeof a!.hasActions).toBe("boolean");
  expect(a!.description.length).toBeLessThanOrEqual(280);
  expect(typeof a!.id).toBe("string");
  expect(a!.id.length).toBeGreaterThan(0);
  expect(Array.isArray(a!.actions)).toBe(true);
});

test("team/role scoping — a principal never retrieves another team's or role's notifications", async () => {
  const teamA = `teamA-${stamp}`;
  const teamB = `teamB-${stamp}`;
  const roleX = `roleX-${stamp}`;
  const roleY = `roleY-${stamp}`;
  const kw = `wgrp${stamp.replace(/[^a-z0-9]/gi, "")}`;

  await persist(
    query,
    {
      id: `grp-teamA-${stamp}`,
      module: "dsr",
      title: `Team A ${kw}`,
      description: "",
      priority: "high",
      snoozable: false,
      audience: { scope: "team", id: teamA },
    },
    false,
  );
  await persist(
    query,
    {
      id: `grp-teamB-${stamp}`,
      module: "dsr",
      title: `Team B ${kw}`,
      description: "",
      priority: "high",
      snoozable: false,
      audience: { scope: "team", id: teamB },
    },
    false,
  );
  await persist(
    query,
    {
      id: `grp-roleY-${stamp}`,
      module: "dsr",
      title: `Role Y ${kw}`,
      description: "",
      priority: "high",
      snoozable: false,
      audience: { scope: "role", id: roleY },
    },
    false,
  );

  // Principal is in team A and role X only.
  const principal: Principal = { userKey: `grp-user-${stamp}`, roles: [roleX], teamKeys: [teamA] };
  const titles = (await retrieveForAnswer(query, principal, kw)).items.map((i) => i.title);

  expect(titles).toContain(`Team A ${kw}`); // own team → visible
  expect(titles).not.toContain(`Team B ${kw}`); // other team → excluded
  expect(titles).not.toContain(`Role Y ${kw}`); // role not held → excluded
});

test("description is truncated to 280 chars", async () => {
  const userKey = `rettrunc-${stamp}`;
  const long = "x".repeat(400);
  await seed({
    id: `ret-long-${stamp}`,
    userScope: userKey,
    title: "Long one",
    description: long,
    priority: "critical",
  });
  const { items } = await retrieveForAnswer(
    query,
    { userKey, roles: [], teamKeys: [] },
    "anything",
  );
  const item = items.find((i) => i.title === "Long one");
  expect(item).toBeDefined();
  expect(item!.description.length).toBe(280);
});

test("a block of criticals does not crowd out normals; stats report the true distribution", async () => {
  const userKey = `mix-${stamp}`;
  const principal: Principal = { userKey, roles: [], teamKeys: [] };
  for (let i = 0; i < 7; i++) {
    await seed({ id: `mix-crit-${i}-${stamp}`, userScope: userKey, priority: "critical" });
  }
  for (let i = 0; i < 6; i++) {
    await seed({ id: `mix-norm-${i}-${stamp}`, userScope: userKey, priority: "normal" });
  }

  // A generic question with no keyword hits — the recency arm must still surface normals.
  const { items, stats } = await retrieveForAnswer(query, principal, "what do I have");

  expect(stats.total).toBe(13);
  expect(stats.byPriority.critical).toBe(7);
  expect(stats.byPriority.normal).toBe(6);
  expect(stats.unread).toBe(13);
  // The model must SEE at least one normal-priority item, not just the block of criticals.
  expect(items.some((i) => i.priority === "normal")).toBe(true);
  expect(items.some((i) => i.priority === "critical")).toBe(true);
});
