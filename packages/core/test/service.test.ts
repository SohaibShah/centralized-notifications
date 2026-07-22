import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Notification } from "@notifications/shared";
import { testPool } from "./harness";
import {
  createNotificationService,
  InvalidCursorError,
  NotFoundError,
  type NotificationService,
} from "../src/service";

const pool = testPool();
let svc: NotificationService;
afterAll(() => pool.end());

beforeAll(async () => {
  svc = createNotificationService({ pool, config: { modules: [{ id: "dsr", label: "DSR" }] } });
  await svc.ready();
});

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const principal = { userKey: `svc-user-${stamp}`, roles: [], teamKeys: [] };
const payload = (id: string): Notification => ({
  id,
  module: "dsr",
  title: id,
  description: "",
  priority: "high",
  snoozable: false,
  audience: { scope: "global" },
});

test("ingest publishes to a matching subscriber and the item is listable + countable", async () => {
  const deliver = vi.fn();
  svc.delivery.subscribe({ principal, deliver });

  const id = `svc-${stamp}`;
  const before = (await svc.counts({ principal })).unread;
  expect(await svc.ingest(payload(id))).toEqual({ status: "accepted", id });
  expect(deliver).toHaveBeenCalledOnce();

  const page = await svc.list({ principal, limit: 100 });
  expect(page.items.map((i) => i.id)).toContain(id);

  await svc.markRead({ principal, id });
  expect((await svc.counts({ principal })).unread).toBe(before); // +1 ingested, then -1 read
});

test("list throws InvalidCursorError for a bad cursor", async () => {
  await expect(svc.list({ principal, cursor: "not-a-real-cursor" })).rejects.toBeInstanceOf(
    InvalidCursorError,
  );
});

test("markRead throws NotFoundError for an id outside the audience", async () => {
  await expect(svc.markRead({ principal, id: `does-not-exist-${stamp}` })).rejects.toBeInstanceOf(
    NotFoundError,
  );
});
