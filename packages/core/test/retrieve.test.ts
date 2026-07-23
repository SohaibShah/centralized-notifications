import { afterAll, expect, test } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import { retrieveForAnswer } from "../src/ai/retrieve";
import type { Principal } from "../src/types";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

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

  const items = await retrieveForAnswer(query, principal, keyword);
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
  const items = await retrieveForAnswer(query, { userKey, roles: [], teamKeys: [] }, "anything");
  const item = items.find((i) => i.title === "Long one");
  expect(item).toBeDefined();
  expect(item!.description.length).toBe(280);
});
