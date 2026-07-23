import { afterAll, beforeAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { markRead, markReadBulk, markUnread } from "../src/read/read-state";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const visibleId = `rs-visible-${stamp}`;
const hiddenId = `rs-hidden-${stamp}`; // team "secret" — not in the principal's teams
const principal = { userKey: `rs-user-${stamp}`, roles: [], teamKeys: ["eng"] };

const notif = (id: string, audience: Notification["audience"]): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  snoozable: false,
  priority: "high",
  audience,
});

async function readCount(id: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM notification_reads WHERE user_key = $1 AND notification_id = $2",
    [principal.userKey, id],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  await persist(query, notif(visibleId, { scope: "global" }), false);
  await persist(query, notif(hiddenId, { scope: "team", id: "secret" }), false);
});

test("markRead on an in-audience id inserts a row and is idempotent", async () => {
  expect(await markRead(query, { principal, id: visibleId })).toEqual({ ok: true });
  expect(await markRead(query, { principal, id: visibleId })).toEqual({ ok: true });
  expect(await readCount(visibleId)).toBe(1);
});

test("markRead on an out-of-audience id returns not found and writes nothing", async () => {
  expect(await markRead(query, { principal, id: hiddenId })).toEqual({
    ok: false,
    error: "not found",
  });
  expect(await readCount(hiddenId)).toBe(0);
});

test("markReadBulk marks only in-audience ids", async () => {
  await markReadBulk(query, { principal, ids: [visibleId, hiddenId] });
  expect(await readCount(visibleId)).toBe(1);
  expect(await readCount(hiddenId)).toBe(0);
});

test("markUnread removes the caller's read row", async () => {
  await markUnread(query, { principal, id: visibleId });
  expect(await readCount(visibleId)).toBe(0);
});
