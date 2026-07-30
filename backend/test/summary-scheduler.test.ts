import { expect, test, vi } from "vitest";
import { createGuardedTick, runSummaryTick } from "../src/summary/scheduler";
import type { ScheduleRow } from "../src/summary/schedule-repo";

const rows: ScheduleRow[] = [
  { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null }, // 08:15 local → due
  { id: "2", userKey: "lon", timezone: "Europe/London", lastGeneratedAt: null }, // 03:45 local → not due
];
const now = () => new Date("2026-07-31T02:45:00.000Z");

test("generates only for due users when enabled", async () => {
  const generate = vi.fn(async () => {});
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => rows,
    generate,
    now,
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]![0].userKey).toBe("kol");
});

test("does nothing when aiSummaryEnabled is false", async () => {
  const generate = vi.fn(async () => {});
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: false, summaryTime: "08:00" }),
    listRows: async () => rows,
    generate,
    now,
  });
  expect(generate).not.toHaveBeenCalled();
});

test("one user's failure does not abort the batch", async () => {
  const three: ScheduleRow[] = [
    { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null },
    { id: "2", userKey: "ktm", timezone: "Asia/Kathmandu", lastGeneratedAt: null },
  ];
  const generate = vi.fn(async (r: ScheduleRow) => {
    if (r.userKey === "kol") throw new Error("boom");
  });
  const onError = vi.fn();
  await runSummaryTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => three,
    generate,
    now,
    onError,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
});

test("re-entrancy guard: a tick that fires while the previous pass is in flight is a no-op", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((r) => (markStarted = r));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const generate = vi.fn(async () => {
    markStarted();
    await gate; // first pass blocks here, keeping the tick "running"
  });
  const tick = createGuardedTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => [
      { id: "1", userKey: "kol", timezone: "Asia/Kolkata", lastGeneratedAt: null },
    ],
    generate,
    now,
  });

  const first = tick();
  await started; // the first pass has entered generate → guard is engaged
  await tick(); // second beat while the first is in flight → dropped
  expect(generate).toHaveBeenCalledTimes(1);

  release();
  await first;
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a rejecting setup query is caught, not surfaced as an unhandled rejection", async () => {
  const tick = createGuardedTick({
    getSettings: async () => ({ aiSummaryEnabled: true, summaryTime: "08:00" }),
    listRows: async () => {
      throw new Error("db down");
    },
    generate: vi.fn(),
    now,
  });
  await expect(tick()).resolves.toBeUndefined();
});
