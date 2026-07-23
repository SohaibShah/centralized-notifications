import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { counts } from "../src/read/counts";
import { list } from "../src/read/feed";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const globalId = `read-global-${stamp}`;
const teamId = `read-team-${stamp}`;
const member = { userKey: `member-${stamp}`, roles: [], teamKeys: ["eng"] };
const nonMember = { userKey: `nonmember-${stamp}`, roles: [], teamKeys: [] };

const notif = (id: string, audience: Notification["audience"]): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  priority: "high",
  snoozable: false,
  audience,
});

beforeAll(async () => {
  await persist(query, notif(globalId, { scope: "global" }), false);
  await persist(query, notif(teamId, { scope: "team", id: "eng" }), false);
});

async function ids(principal: typeof member): Promise<string[]> {
  const res = await list(query, { principal, limit: 100 });
  if (!res.ok) throw new Error(res.error);
  return res.page.items.map((i) => i.id);
}

test("a team member sees the global + their team notification", async () => {
  const seen = await ids(member);
  expect(seen).toContain(globalId);
  expect(seen).toContain(teamId);
});

test("a non-member sees the global but not the team notification", async () => {
  const seen = await ids(nonMember);
  expect(seen).toContain(globalId);
  expect(seen).not.toContain(teamId);
});

test("marking read flips the row's read flag and drops the unread count by one", async () => {
  const before = (await counts(query, { principal: member })).unread;

  await query("INSERT INTO notification_reads (user_key, notification_id) VALUES ($1, $2)", [
    member.userKey,
    globalId,
  ]);

  const res = await list(query, { principal: member, limit: 100 });
  if (!res.ok) throw new Error(res.error);
  expect(res.page.items.find((i) => i.id === globalId)?.read).toBe(true);

  const after = (await counts(query, { principal: member })).unread;
  expect(after).toBe(before - 1);
});
