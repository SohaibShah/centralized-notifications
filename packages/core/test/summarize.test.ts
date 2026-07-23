import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Notification } from "@notifications/shared";
import { AiDisabledError, AiNotConfiguredError, AiProviderError } from "../src/ai/errors";
import { SummaryEngine } from "../src/ai/summarize";
import { createDb } from "../src/db";
import { persist } from "../src/pipeline/persist";
import type { AiProvider, Settings } from "../src/types";
import { testPool } from "./harness";

const pool = testPool();
const { query } = createDb(pool);
afterAll(() => pool.end());

// These tests assert absolute `basedOn` counts for freshly-stamped user-scoped principals. Sibling
// test files seed GLOBAL-scoped notifications into the shared core test DB — those are visible to
// every principal, so any that leaked in before this file runs would inflate the counts. Unique-id
// isolation can't cover globals; clear them once so the counts are deterministic regardless of the
// order vitest happens to run the files in.
beforeAll(async () => {
  await query(`DELETE FROM notifications WHERE audience_scope = 'global'`);
});

const on: Settings = {
  aiSummaryEnabled: true,
  chatbotEnabled: true,
  groupingEnabled: true,
  actionsEnabled: true,
  retentionDays: 30,
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const seed = async (userScope: string, id: string) => {
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

test("aiSummaryEnabled false → AiDisabledError, provider not called", async () => {
  const provider = { complete: vi.fn(async () => "x") } satisfies AiProvider;
  const engine = new SummaryEngine({
    query,
    getSettings: async () => ({ ...on, aiSummaryEnabled: false }),
    provider,
  });
  await expect(
    engine.summarize({ userKey: `d-${stamp}`, roles: [], teamKeys: [] }),
  ).rejects.toBeInstanceOf(AiDisabledError);
  expect(provider.complete).not.toHaveBeenCalled();
});

test("no provider → AiNotConfiguredError", async () => {
  const engine = new SummaryEngine({ query, getSettings: async () => on });
  await expect(
    engine.summarize({ userKey: `nc-${stamp}`, roles: [], teamKeys: [] }),
  ).rejects.toBeInstanceOf(AiNotConfiguredError);
});

test("empty unread → caught-up, provider not called", async () => {
  const provider = { complete: vi.fn(async () => "x") } satisfies AiProvider;
  const engine = new SummaryEngine({ query, getSettings: async () => on, provider });
  const res = await engine.summarize({ userKey: `empty-${stamp}`, roles: [], teamKeys: [] });
  expect(res).toEqual({ summary: "You're all caught up.", basedOn: 0 });
  expect(provider.complete).not.toHaveBeenCalled();
});

test("with unread → provider result; unchanged set is served from cache (no 2nd call)", async () => {
  const userKey = `hit-${stamp}`;
  await seed(userKey, `hit-a-${stamp}`);
  const provider = { complete: vi.fn(async () => "  a digest  ") } satisfies AiProvider;
  const engine = new SummaryEngine({ query, getSettings: async () => on, provider });
  const principal = { userKey, roles: [], teamKeys: [] };

  const first = await engine.summarize(principal);
  expect(first).toEqual({ summary: "a digest", basedOn: 1 });
  await engine.summarize(principal); // unchanged set
  expect(provider.complete).toHaveBeenCalledTimes(1); // cache hit
});

test("an empty/whitespace completion → AiProviderError (not cached as a blank summary)", async () => {
  const userKey = `blank-${stamp}`;
  await seed(userKey, `blank-a-${stamp}`);
  const provider = { complete: vi.fn(async () => "   ") } satisfies AiProvider;
  const engine = new SummaryEngine({ query, getSettings: async () => on, provider });
  const principal = { userKey, roles: [], teamKeys: [] };
  await expect(engine.summarize(principal)).rejects.toBeInstanceOf(AiProviderError);
  // Not cached: a second call still hits the (now non-blank) provider rather than a stored blank.
  provider.complete.mockResolvedValueOnce("recovered");
  expect(await engine.summarize(principal)).toEqual({ summary: "recovered", basedOn: 1 });
});

test("a throwing provider → AiProviderError", async () => {
  const userKey = `err-${stamp}`;
  await seed(userKey, `err-a-${stamp}`);
  const provider = {
    complete: vi.fn(async () => {
      throw new Error("boom");
    }),
  } satisfies AiProvider;
  const engine = new SummaryEngine({ query, getSettings: async () => on, provider });
  await expect(engine.summarize({ userKey, roles: [], teamKeys: [] })).rejects.toBeInstanceOf(
    AiProviderError,
  );
});
