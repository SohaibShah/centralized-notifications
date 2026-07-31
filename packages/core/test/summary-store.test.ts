import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Notification } from "@notifications/shared";
import { createDb } from "../src/db";
import { createSummaryStore } from "../src/ai/summary-store";
import { createNotificationService, type NotificationService } from "../src/service";
import { persist } from "../src/pipeline/persist";
import type { AiProvider } from "../src/types";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const completeSpy = vi.fn(async () => "a digest");
let svc: NotificationService;

beforeAll(async () => {
  // Sibling files seed GLOBAL-scoped notifications into the shared core test DB (visible to every
  // principal); clear them so a fresh principal genuinely has zero unread for the caught-up test.
  await query(`DELETE FROM notifications WHERE audience_scope = 'global'`);
  // This service instance's PolicyStore caches settings and is only invalidated by its own writes,
  // so priming it here pins aiSummaryEnabled=true for this file regardless of concurrent toggles.
  await query(`UPDATE global_settings SET ai_summary_enabled = true WHERE id = true`);
  svc = createNotificationService({
    pool,
    config: {
      modules: [{ id: "dsr", label: "DSR" }],
      ai: { provider: { complete: completeSpy } satisfies AiProvider },
    },
  });
  await svc.ready();
  await svc.getSettings(); // prime the settings cache
});
afterAll(() => pool.end());

const seedUnread = async (userScope: string, id: string) => {
  const n: Notification = {
    id,
    module: "dsr",
    title: id,
    description: "",
    priority: "high",
    snoozable: false,
    audience: { scope: "user", id: userScope },
  };
  await persist(query, n, false);
};

test("summary store: upsert then get round-trips, and upsert replaces", async () => {
  const store = createSummaryStore(query);
  const uk = `store-${stamp}`;
  expect(await store.get(uk)).toBeNull();
  await store.upsert(uk, { summary: "hi", basedOn: 3, generatedAt: "2026-07-31T08:00:00.000Z" });
  expect(await store.get(uk)).toEqual({
    summary: "hi",
    basedOn: 3,
    generatedAt: "2026-07-31T08:00:00.000Z",
  });
  await store.upsert(uk, { summary: "bye", basedOn: 0, generatedAt: "2026-07-31T09:00:00.000Z" });
  expect(await store.get(uk)).toEqual({
    summary: "bye",
    basedOn: 0,
    generatedAt: "2026-07-31T09:00:00.000Z",
  });
});

test("refreshSummary generates + persists, and getStoredSummary reads it back", async () => {
  const userKey = `refresh-${stamp}`;
  await seedUnread(userKey, `refresh-a-${stamp}`);
  const principal = { userKey, roles: [], teamKeys: [] };

  expect(await svc.getStoredSummary({ principal })).toBeNull();
  const res = await svc.refreshSummary({ principal });
  expect(res.basedOn).toBe(1);
  expect(res.summary).toBe("a digest");
  expect(typeof res.generatedAt).toBe("string");
  expect(await svc.getStoredSummary({ principal })).toEqual(res);
});

test("refreshSummary writes a based_on:0 marker with NO provider call when nothing is unread", async () => {
  const principal = { userKey: `empty-${stamp}`, roles: [], teamKeys: [] };
  completeSpy.mockClear();
  const res = await svc.refreshSummary({ principal });
  expect(res.basedOn).toBe(0);
  expect(completeSpy).not.toHaveBeenCalled();
  expect((await svc.getStoredSummary({ principal }))?.basedOn).toBe(0);
});
